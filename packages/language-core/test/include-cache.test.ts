import { describe, expect, it } from "vitest";
import { buildIncludeGraph, IncludeAnalysisCache } from "../src/index.js";
import type { FileSystemProvider, ResourceStat } from "../src/index.js";

interface MutableFile {
  text: string;
  stat: ResourceStat;
}

function cachingFileSystem(initial: Readonly<Record<string, MutableFile>>): {
  readonly fileSystem: FileSystemProvider;
  readonly files: Record<string, MutableFile>;
  readonly reads: Map<string, number>;
} {
  const files = { ...initial };
  const reads = new Map<string, number>();
  return {
    files,
    reads,
    fileSystem: {
      readFile(uri): Promise<string> {
        const file = files[uri];
        if (file === undefined) throw new Error(`missing file ${uri}`);
        reads.set(uri, (reads.get(uri) ?? 0) + 1);
        return Promise.resolve(file.text);
      },
      readDirectory(): Promise<readonly string[]> {
        throw new Error("directories are not used by these cache tests");
      },
      stat(uri): Promise<ResourceStat> {
        const file = files[uri];
        if (file === undefined) throw new Error(`missing file ${uri}`);
        return Promise.resolve(file.stat);
      },
      resolve(baseUri, target): string {
        return new URL(target, baseUri).toString();
      },
      join(baseDirectoryUri, entry): string {
        return new URL(entry, `${baseDirectoryUri.replace(/\/$/u, "")}/`).toString();
      },
      normalize(uri): string {
        return new URL(uri).toString();
      },
    },
  };
}

function regularFile(
  text: string,
  identity: { readonly size?: number; readonly mtime?: number; readonly etag?: string } = {},
): MutableFile {
  return {
    text,
    stat: {
      type: "file",
      size: identity.size ?? text.length,
      mtime: identity.mtime ?? 1,
      etag: identity.etag ?? "one",
    },
  };
}

describe("cross-analysis include cache", () => {
  it("reuses the same parsed document for an unchanged normalized URI and identity", async () => {
    const sharedUri = "file:///workspace/shared.conf";
    const { fileSystem, files, reads } = cachingFileSystem({
      [sharedUri]: regularFile("daily\n"),
    });
    const cache = new IncludeAnalysisCache();

    const first = await buildIncludeGraph(
      "file:///workspace/root.conf",
      "include ./shared.conf\n",
      fileSystem,
      {},
      () => false,
      cache,
      "3.22",
    );
    files[sharedUri] = regularFile("weekly\n", { size: 6, mtime: 1, etag: "one" });
    const second = await buildIncludeGraph(
      "file:///workspace/root.conf",
      "include shared.conf\n",
      fileSystem,
      {},
      () => false,
      cache,
      "3.22",
    );

    expect(reads.get(sharedUri)).toBe(1);
    expect(second.files.get(sharedUri)?.document).toBe(first.files.get(sharedUri)?.document);
    expect(second.files.get(sharedUri)?.document.source).toBe("daily\n");
  });

  it.each([
    {
      identityPart: "size",
      change: (stat: ResourceStat): ResourceStat => ({ ...stat, size: (stat.size ?? 0) + 1 }),
    },
    {
      identityPart: "mtime",
      change: (stat: ResourceStat): ResourceStat => ({ ...stat, mtime: (stat.mtime ?? 0) + 1 }),
    },
    {
      identityPart: "etag",
      change: (stat: ResourceStat): ResourceStat => ({ ...stat, etag: "two" }),
    },
  ])("misses when the resource $identityPart changes", async ({ change }) => {
    const sharedUri = "file:///workspace/shared.conf";
    const { fileSystem, files, reads } = cachingFileSystem({
      [sharedUri]: regularFile("UNKNOWN\n"),
    });
    const cache = new IncludeAnalysisCache();
    const first = await buildIncludeGraph(
      "file:///workspace/root.conf",
      "include shared.conf\n",
      fileSystem,
      {},
      () => false,
      cache,
      "3.22",
    );

    const previous = files[sharedUri];
    if (previous === undefined) throw new Error("missing shared fixture");
    files[sharedUri] = { text: "daily\n", stat: change(previous.stat) };
    const second = await buildIncludeGraph(
      "file:///workspace/root.conf",
      "include shared.conf\n",
      fileSystem,
      {},
      () => false,
      cache,
      "3.22",
    );

    expect(reads.get(sharedUri)).toBe(2);
    expect(second.files.get(sharedUri)?.document).not.toBe(first.files.get(sharedUri)?.document);
    expect(second.files.get(sharedUri)?.document.source).toBe("daily\n");
    expect(second.files.get(sharedUri)?.document.diagnostics).toEqual([]);
  });

  it("keys entries by target version and the complete inherited settings and taboo context", async () => {
    const sharedUri = "file:///workspace/shared.conf";
    const { fileSystem, reads } = cachingFileSystem({
      [sharedUri]: regularFile("rotate 4\n"),
    });
    const cache = new IncludeAnalysisCache();
    const build = async (source: string, targetVersion: string) =>
      buildIncludeGraph(
        "file:///workspace/root.conf",
        source,
        fileSystem,
        {},
        () => false,
        cache,
        targetVersion,
      );

    const first = await build("daily\ntaboopat *.skip\ninclude shared.conf\n", "3.22");
    const identical = await build("daily\ntaboopat *.skip\ninclude shared.conf\n", "3.22");
    const differentTarget = await build("daily\ntaboopat *.skip\ninclude shared.conf\n", "latest");
    const differentInheritedSetting = await build(
      "weekly\ntaboopat *.skip\ninclude shared.conf\n",
      "latest",
    );
    const differentTabooState = await build(
      "weekly\ntaboopat *.tmp\ninclude shared.conf\n",
      "latest",
    );

    expect(reads.get(sharedUri)).toBe(4);
    expect(identical.files.get(sharedUri)?.document).toBe(first.files.get(sharedUri)?.document);
    expect(differentTarget.files.get(sharedUri)?.document).not.toBe(
      identical.files.get(sharedUri)?.document,
    );
    expect(differentInheritedSetting.files.get(sharedUri)?.document).not.toBe(
      differentTarget.files.get(sharedUri)?.document,
    );
    expect(differentTabooState.files.get(sharedUri)?.document).not.toBe(
      differentInheritedSetting.files.get(sharedUri)?.document,
    );
    expect([
      ...(differentInheritedSetting.files.get(sharedUri)?.inheritedSettings.keys() ?? []),
    ]).toEqual(["weekly", "taboopat"]);
  });

  it("invalidates one changed resource and preserves reusable entries with unchanged inherited state", async () => {
    const sharedUri = "file:///workspace/shared.conf";
    const leafUri = "file:///workspace/leaf.conf";
    const unrelatedUri = "file:///workspace/unrelated.conf";
    const { fileSystem, files, reads } = cachingFileSystem({
      [sharedUri]: regularFile("include leaf.conf\n"),
      [leafUri]: regularFile("UNKNOWN\n"),
      [unrelatedUri]: regularFile("weekly\n"),
    });
    const cache = new IncludeAnalysisCache();
    const source = "include unrelated.conf\ninclude shared.conf\n";
    const build = () =>
      buildIncludeGraph(
        "file:///workspace/root.conf",
        source,
        fileSystem,
        {},
        () => false,
        cache,
        "3.22",
      );
    const first = await build();
    const sharedDocument = first.files.get(sharedUri)?.document;
    const unrelatedDocument = first.files.get(unrelatedUri)?.document;

    files[leafUri] = regularFile("daily\n", { size: 8, mtime: 1, etag: "one" });
    cache.invalidate(leafUri);
    const refreshed = await build();

    expect(reads).toEqual(
      new Map([
        [sharedUri, 1],
        [leafUri, 2],
        [unrelatedUri, 1],
      ]),
    );
    expect(refreshed.files.get(sharedUri)?.document).toBe(sharedDocument);
    expect(refreshed.files.get(unrelatedUri)?.document).toBe(unrelatedDocument);
    expect(refreshed.files.get(leafUri)?.document.source).toBe("daily\n");
    expect(refreshed.files.get(leafUri)?.document.diagnostics).toEqual([]);
  });

  it("clear evicts every cached include and leaves subsequent graphs semantically fresh", async () => {
    const firstUri = "file:///workspace/first.conf";
    const secondUri = "file:///workspace/second.conf";
    const { fileSystem, files, reads } = cachingFileSystem({
      [firstUri]: regularFile("daily\n"),
      [secondUri]: regularFile("weekly\n"),
    });
    const cache = new IncludeAnalysisCache();
    const source = "include first.conf\ninclude second.conf\n";
    const build = () =>
      buildIncludeGraph(
        "file:///workspace/root.conf",
        source,
        fileSystem,
        {},
        () => false,
        cache,
        "3.22",
      );
    await build();
    await build();
    files[firstUri] = regularFile("monthly\n", { size: 6, mtime: 1, etag: "one" });
    files[secondUri] = regularFile("yearly\n", { size: 7, mtime: 1, etag: "one" });
    cache.clear();
    const refreshed = await build();

    expect(reads).toEqual(
      new Map([
        [firstUri, 2],
        [secondUri, 2],
      ]),
    );
    expect(refreshed.files.get(firstUri)?.document.source).toBe("monthly\n");
    expect(refreshed.files.get(secondUri)?.document.source).toBe("yearly\n");
    expect([
      ...(refreshed.files.get("file:///workspace/root.conf")?.effectiveSettings.keys() ?? []),
    ]).toEqual(["monthly", "yearly"]);
  });
});
