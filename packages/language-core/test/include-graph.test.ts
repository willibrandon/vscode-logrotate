import { describe, expect, it } from "vitest";
import { buildIncludeGraph } from "../src/index.js";
import type { FileSystemProvider, ResourceStat } from "../src/index.js";

function fakeFileSystem(
  entries: Readonly<Record<string, string | readonly string[]>>,
): FileSystemProvider {
  return {
    readFile(uri: string): Promise<string> {
      const value = entries[uri];
      if (typeof value !== "string") throw new Error("not a file");
      return Promise.resolve(value);
    },
    readDirectory(uri: string): Promise<readonly string[]> {
      const value = entries[uri];
      if (value === undefined || typeof value === "string") throw new Error("not a directory");
      return Promise.resolve(value);
    },
    stat(uri: string): Promise<ResourceStat> {
      const value = entries[uri];
      if (value === undefined) throw new Error("missing");
      return Promise.resolve({
        type: typeof value === "string" ? "file" : "directory",
        size: value.length,
      });
    },
    resolve(baseUri: string, target: string): string {
      if (target.startsWith("file:///")) return target;
      const base = baseUri.slice(0, baseUri.lastIndexOf("/") + 1);
      return target.startsWith("/") ? `file://${target}` : `${base}${target}`;
    },
    normalize(uri: string): string {
      return uri.replaceAll("/./", "/");
    },
  };
}

describe("include graph", () => {
  it("loads directly referenced files lazily and sorts directory entries", async () => {
    const fs = fakeFileSystem({
      "file:///etc/logrotate.conf": "",
      "file:///etc/logrotate.d": ["z", "a", "ignored.bak"],
      "file:///etc/logrotate.d/a": "daily\n",
      "file:///etc/logrotate.d/z": "weekly\n",
      "file:///etc/logrotate.d/ignored.bak": "monthly\n",
    });
    const graph = await buildIncludeGraph(
      "file:///etc/logrotate.conf",
      "include file:///etc/logrotate.d\n",
      fs,
    );
    expect([...graph.files.keys()]).toEqual([
      "file:///etc/logrotate.conf",
      "file:///etc/logrotate.d/a",
      "file:///etc/logrotate.d/z",
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("reports cycles, depth, missing files, resource limits, and cancellation", async () => {
    const fs = fakeFileSystem({
      "file:///root": "include file:///a\ninclude file:///missing\n",
      "file:///a": "include file:///root\n",
    });
    const graph = await buildIncludeGraph(
      "file:///root",
      "include file:///a\ninclude file:///missing\n",
      fs,
    );
    expect(graph.diagnostics.map(({ code }) => code)).toEqual(["LR3002", "LR3001"]);
    const limited = await buildIncludeGraph("file:///root", "include file:///a\n", fs, {
      maxFiles: 1,
    });
    expect(limited.diagnostics[0]?.code).toBe("LR3004");
    const cancelled = await buildIncludeGraph(
      "file:///root",
      "include file:///a\n",
      fs,
      {},
      () => true,
    );
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.files.size).toBe(1);
  });
});
