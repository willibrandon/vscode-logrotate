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
    join(baseDirectoryUri: string, entry: string): string {
      return `${baseDirectoryUri.replace(/\/$/u, "")}/${entry}`;
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

  it("applies includes inline and snapshots inherited settings in alphabetic order", async () => {
    const fs = fakeFileSystem({
      "file:///root": "",
      "file:///parts": ["20-compress", "10-weekly"],
      "file:///parts/10-weekly": "weekly\n",
      "file:///parts/20-compress": "compress\n",
    });
    const graph = await buildIncludeGraph(
      "file:///root",
      "daily\ninclude file:///parts\nrotate 4\n/var/log/a {\n  delaycompress\n}\n",
      fs,
    );
    const weekly = graph.files.get("file:///parts/10-weekly");
    const compress = graph.files.get("file:///parts/20-compress");
    expect([...(weekly?.inheritedSettings.keys() ?? [])]).toEqual(["daily"]);
    expect([...(compress?.inheritedSettings.keys() ?? [])]).toEqual(["daily", "weekly"]);
    expect([...(graph.files.get("file:///root")?.effectiveSettings.keys() ?? [])]).toEqual([
      "daily",
      "weekly",
      "compress",
      "rotate",
    ]);
    expect([...(graph.rotations[0]?.settings.keys() ?? [])]).toEqual([
      "daily",
      "weekly",
      "compress",
      "rotate",
      "delaycompress",
    ]);
    expect(graph.rotations[0]?.settings.get("weekly")?.uri).toBe("file:///parts/10-weekly");
  });

  it("implements taboo replacement and append semantics without reading ignored entries", async () => {
    const reads: string[] = [];
    const base = fakeFileSystem({
      "file:///root": "",
      "file:///parts": ["keep.bak", "drop.skip", "keep.conf"],
      "file:///parts/keep.bak": "daily\n",
      "file:///parts/drop.skip": "weekly\n",
      "file:///parts/keep.conf": "monthly\n",
    });
    const fs: FileSystemProvider = {
      ...base,
      readFile(uri): Promise<string> {
        reads.push(uri);
        return base.readFile(uri);
      },
    };
    const replaced = await buildIncludeGraph(
      "file:///root",
      "tabooext .skip\ninclude file:///parts\n",
      fs,
    );
    expect([...replaced.files.keys()]).toEqual([
      "file:///root",
      "file:///parts/keep.bak",
      "file:///parts/keep.conf",
    ]);
    expect(reads).not.toContain("file:///parts/drop.skip");

    reads.length = 0;
    const appended = await buildIncludeGraph(
      "file:///root",
      "tabooext + .skip\ninclude file:///parts\n",
      fs,
    );
    expect([...appended.files.keys()]).toEqual(["file:///root", "file:///parts/keep.conf"]);
    expect(reads).toEqual(["file:///parts/keep.conf"]);
  });

  it("bounds UTF-8 bytes, directory entries, and include depth", async () => {
    const entries: Record<string, string | readonly string[]> = {
      "file:///root": "",
      "file:///parts": ["a", "b", "c"],
      "file:///parts/a": "😀".repeat(8),
      "file:///parts/b": "daily\n",
      "file:///parts/c": "weekly\n",
    };
    for (let depth = 0; depth <= 17; depth += 1) {
      entries[`file:///depth-${depth}`] =
        depth === 17 ? "daily\n" : `include file:///depth-${depth + 1}\n`;
    }
    const fs = fakeFileSystem(entries);
    const boundedEntries = await buildIncludeGraph("file:///root", "include file:///parts\n", fs, {
      maxDirectoryEntries: 2,
      maxFileBytes: 30,
    });
    expect(boundedEntries.diagnostics.map(({ code }) => code)).toEqual(["LR3007", "LR3005"]);
    expect(boundedEntries.files.has("file:///parts/c")).toBe(false);

    const deep = await buildIncludeGraph("file:///depth-0", "include file:///depth-1\n", fs);
    expect(deep.files.has("file:///depth-16")).toBe(true);
    expect(deep.files.has("file:///depth-17")).toBe(false);
    expect(deep.diagnostics.at(-1)?.code).toBe("LR3003");
  });

  it("rejects oversized roots and measures every UTF-8 width exactly", async () => {
    const source = "aé€😀";
    const fs = fakeFileSystem({ "file:///root": "" });
    const graph = await buildIncludeGraph("file:///root", source, fs, {
      maxFileBytes: 9,
      maxTotalBytes: 9,
    });
    expect(graph).toMatchObject({ totalBytes: 10, cancelled: false });
    expect(graph.files.size).toBe(0);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "LR3005", start: 0, end: 0 }),
    ]);
  });

  it("reports unsupported resources, directory failures, and unreadable directory entries", async () => {
    const base = fakeFileSystem({
      "file:///root": "",
      "file:///broken-directory": [],
      "file:///parts": ["missing", "nested", ".", "..", "valid"],
      "file:///parts/nested": [],
      "file:///parts/valid": "daily\n",
    });
    const fs: FileSystemProvider = {
      ...base,
      readDirectory(resource): Promise<readonly string[]> {
        if (resource === "file:///broken-directory") throw new Error("permission denied");
        return base.readDirectory(resource);
      },
      stat(resource): Promise<ResourceStat> {
        if (resource === "file:///special") return Promise.resolve({ type: "other" });
        return base.stat(resource);
      },
    };
    const graph = await buildIncludeGraph(
      "file:///root",
      [
        "include file:///special",
        "include file:///broken-directory",
        "include file:///parts",
        "",
      ].join("\n"),
      fs,
    );
    expect(graph.diagnostics.map(({ code }) => code)).toEqual(["LR3006", "LR3001", "LR3001"]);
    expect(graph.files.has("file:///parts/nested")).toBe(false);
    expect(graph.files.has("file:///parts/valid")).toBe(true);
  });

  it("enforces declared and measured file limits and recovers from read failures", async () => {
    const base = fakeFileSystem({
      "file:///root": "",
      "file:///declared-large": "daily\n",
      "file:///measured-large": "é".repeat(600),
      "file:///unreadable": "weekly\n",
      "file:///valid": "monthly\n",
    });
    const fs: FileSystemProvider = {
      ...base,
      readFile(resource): Promise<string> {
        if (resource === "file:///unreadable") throw new Error("permission denied");
        return base.readFile(resource);
      },
      stat(resource): Promise<ResourceStat> {
        if (resource === "file:///declared-large") {
          return Promise.resolve({ type: "file", size: 1_000_000 });
        }
        if (resource === "file:///measured-large") {
          return Promise.resolve({ type: "file" });
        }
        return base.stat(resource);
      },
    };
    const graph = await buildIncludeGraph(
      "file:///root",
      [
        "include file:///declared-large",
        "include file:///measured-large",
        "include file:///unreadable",
        "include file:///valid",
        "",
      ].join("\n"),
      fs,
      { maxFileBytes: 1_000, maxTotalBytes: 10_000 },
    );
    expect(graph.diagnostics.map(({ code }) => code)).toEqual(["LR3005", "LR3005", "LR3001"]);
    expect([...graph.files.keys()]).toEqual(["file:///root", "file:///valid"]);
    expect(graph.totalBytes).toBeGreaterThan(0);
  });

  it("caches a repeated include while applying it at each inline position", async () => {
    let reads = 0;
    const base = fakeFileSystem({
      "file:///root": "",
      "file:///shared": "weekly\n",
    });
    const fs: FileSystemProvider = {
      ...base,
      readFile(resource): Promise<string> {
        reads += 1;
        return base.readFile(resource);
      },
    };
    const graph = await buildIncludeGraph(
      "file:///root",
      "daily\ninclude file:///shared\nmonthly\ninclude file:///shared\n",
      fs,
    );
    expect(reads).toBe(1);
    expect([...(graph.files.get("file:///shared")?.inheritedSettings.keys() ?? [])]).toEqual([
      "daily",
      "weekly",
      "monthly",
    ]);
    expect([...(graph.files.get("file:///root")?.effectiveSettings.keys() ?? [])]).toEqual([
      "daily",
      "weekly",
      "monthly",
    ]);
  });

  it("supports question-mark taboo globs and bounds pathological patterns", async () => {
    const longPattern = "x".repeat(4097);
    const longName = "x".repeat(4097);
    const fs = fakeFileSystem({
      "file:///root": "",
      "file:///parts": ["drop-1.conf", "drop-12.conf", longName],
      "file:///parts/drop-1.conf": "daily\n",
      "file:///parts/drop-12.conf": "weekly\n",
      [`file:///parts/${longName}`]: "monthly\n",
    });
    const graph = await buildIncludeGraph(
      "file:///root",
      `taboopat drop-?.conf,${longPattern}\ninclude file:///parts\n`,
      fs,
    );
    expect(graph.files.has("file:///parts/drop-1.conf")).toBe(false);
    expect(graph.files.has("file:///parts/drop-12.conf")).toBe(true);
    expect(graph.files.has(`file:///parts/${longName}`)).toBe(true);
  });
});
