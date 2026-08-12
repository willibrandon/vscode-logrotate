import { afterEach, describe, expect, it } from "vitest";
import {
  includedResourceChangedNotification,
  refreshDiagnosticsNotification,
} from "../src/protocol.js";
import { createServerHarness } from "./harness.js";
import type { ServerHarness } from "./harness.js";
import type { TimerHost } from "../src/server.js";

describe("include cache and loaded-resource server contract", () => {
  let harness: ServerHarness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  it("reuses cached includes across root analyses and misses on target or stat identity changes", async () => {
    const rootUri = "file:///workspace/root.conf";
    const sharedUri = "file:///workspace/shared.conf";
    const files: Record<string, { text: string; size: number; mtime: number; etag: string }> = {
      [sharedUri]: { text: "daily\n", size: 6, mtime: 1, etag: "one" },
    };
    harness = await createServerHarness(files);
    await harness.open(rootUri, "logrotate", "include shared.conf\n");
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri);
    expect(harness.fileReadCount(sharedUri)).toBe(1);

    let after = harness.loadedIncludeNotifications().length;
    await harness.change(rootUri, "include shared.conf\n# unrelated root edit\n", 2);
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(harness.fileReadCount(sharedUri)).toBe(1);

    after = harness.loadedIncludeNotifications().length;
    await harness.configure({ logrotate: { targetVersion: "3.22" } });
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(harness.fileReadCount(sharedUri)).toBe(2);

    files[sharedUri] = { text: "weekly\n", size: 7, mtime: 2, etag: "two" };
    after = harness.loadedIncludeNotifications().length;
    await harness.change(rootUri, "include shared.conf\n# force analysis after stat change\n", 3);
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(harness.fileReadCount(sharedUri)).toBe(3);
  });

  it("invalidates a watched include once and refreshes every and only root that loaded it", async () => {
    const firstRoot = "file:///workspace/first.conf";
    const secondRoot = "file:///workspace/second.conf";
    const unrelatedRoot = "file:///workspace/unrelated-root.conf";
    const sharedUri = "file:///workspace/shared.conf";
    const unrelatedUri = "file:///workspace/unrelated.conf";
    const files: Record<string, { text: string; size: number; mtime: number; etag: string }> = {
      [sharedUri]: { text: "UNKNOWN\n", size: 8, mtime: 1, etag: "shared-one" },
      [unrelatedUri]: { text: "daily\n", size: 6, mtime: 1, etag: "other-one" },
    };
    harness = await createServerHarness(files);
    await harness.open(firstRoot, "logrotate", "include shared.conf\n");
    await harness.waitForLoadedIncludes(({ rootUri }) => rootUri === firstRoot);
    await harness.open(secondRoot, "logrotate", "include shared.conf\n");
    await harness.waitForLoadedIncludes(({ rootUri }) => rootUri === secondRoot);
    await harness.open(unrelatedRoot, "logrotate", "include unrelated.conf\n");
    await harness.waitForLoadedIncludes(({ rootUri }) => rootUri === unrelatedRoot);
    expect(harness.fileReadCount(sharedUri)).toBe(1);
    expect(harness.fileReadCount(unrelatedUri)).toBe(1);

    files[sharedUri] = { text: "weekly\n", size: 7, mtime: 2, etag: "shared-two" };
    const after = harness.loadedIncludeNotifications().length;
    const unrelatedNotificationCount = harness
      .loadedIncludeNotifications()
      .filter(({ rootUri }) => rootUri === unrelatedRoot).length;
    await harness.client.sendNotification(includedResourceChangedNotification, { uri: sharedUri });
    const [firstRefresh, secondRefresh] = await Promise.all([
      harness.waitForLoadedIncludes(({ rootUri }) => rootUri === firstRoot, after),
      harness.waitForLoadedIncludes(({ rootUri }) => rootUri === secondRoot, after),
    ]);

    expect(firstRefresh.resources).toEqual([{ uri: sharedUri, type: "file" }]);
    expect(secondRefresh.resources).toEqual([{ uri: sharedUri, type: "file" }]);
    expect(harness.fileReadCount(sharedUri)).toBeGreaterThan(1);
    expect(harness.fileReadCount(unrelatedUri)).toBe(1);
    expect(
      harness.loadedIncludeNotifications().filter(({ rootUri }) => rootUri === unrelatedRoot)
        .length,
    ).toBe(unrelatedNotificationCount);
    expect(
      await harness.waitForDiagnostics(sharedUri, (diagnostics) => diagnostics.length === 0),
    ).toMatchObject({ uri: sharedUri, diagnostics: [] });

    const beforeClose = harness.loadedIncludeNotifications().length;
    await harness.close(firstRoot);
    expect(
      await harness.waitForLoadedIncludes(
        ({ rootUri, resources }) => rootUri === firstRoot && resources.length === 0,
        beforeClose,
      ),
    ).toEqual({ rootUri: firstRoot, resources: [] });
  });

  it("invalidates cached resources when an included document opens, changes, and closes", async () => {
    const rootUri = "file:///workspace/root.conf";
    const sharedUri = "file:///workspace/shared.conf";
    const files = {
      [sharedUri]: { text: "UNKNOWN\n", size: 8, mtime: 1, etag: "disk" },
    };
    harness = await createServerHarness(files);
    await harness.open(rootUri, "logrotate", "include shared.conf\n");
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri);
    expect(harness.fileReadCount(sharedUri)).toBe(1);

    let after = harness.loadedIncludeNotifications().length;
    await harness.open(sharedUri, "logrotate", "daily\n");
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(
      await harness.waitForDiagnostics(sharedUri, (diagnostics) => diagnostics.length === 0),
    ).toMatchObject({ uri: sharedUri, diagnostics: [] });
    expect(harness.fileReadCount(sharedUri)).toBe(1);

    after = harness.loadedIncludeNotifications().length;
    await harness.change(sharedUri, "rotate nope\n", 2);
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(
      await harness.waitForDiagnostics(sharedUri, (diagnostics) =>
        diagnostics.some(({ code }) => code === "LR1104"),
      ),
    ).toMatchObject({ uri: sharedUri });
    expect(harness.fileReadCount(sharedUri)).toBe(1);

    after = harness.loadedIncludeNotifications().length;
    await harness.close(sharedUri);
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);
    expect(
      await harness.waitForDiagnostics(sharedUri, (diagnostics) =>
        diagnostics.some(({ code }) => code === "LR1001"),
      ),
    ).toMatchObject({ uri: sharedUri });
    expect(harness.fileReadCount(sharedUri)).toBe(2);
  });

  it("republishes an included diagnostic for the open document version and exact token range", async () => {
    const rootUri = "file:///workspace/root.conf";
    const includedUri = "file:///workspace/included.conf";
    const includedText = "/var/log/included.log {\n    rotote 2\n}\n";
    const delays: number[] = [];
    const timers: TimerHost = {
      setTimeout(callback, milliseconds): ReturnType<typeof setTimeout> {
        delays.push(milliseconds);
        return setTimeout(callback, 1);
      },
      clearTimeout(handle): void {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };
    harness = await createServerHarness(
      {
        [includedUri]: { text: includedText, size: includedText.length, mtime: 1 },
      },
      timers,
    );
    await harness.open(rootUri, "logrotate", "include included.conf\n");
    const closedPublication = await harness.waitForDiagnostics(
      includedUri,
      (diagnostics, publication) =>
        publication.version === undefined && diagnostics.some(({ code }) => code === "LR1001"),
    );
    expect(closedPublication.version).toBeUndefined();

    const delaysBeforeOpen = delays.length;
    await harness.open(includedUri, "logrotate", includedText);
    const openedPublication = await harness.waitForDiagnostics(
      includedUri,
      (diagnostics, publication) =>
        publication.version === 1 && diagnostics.some(({ code }) => code === "LR1001"),
    );
    expect(openedPublication.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LR1001",
        severity: 1,
        range: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 10 },
        },
      }),
    );
    const openDelays = delays.slice(delaysBeforeOpen);
    expect(openDelays.every((delay) => delay === 150)).toBe(true);

    const afterRefresh = harness.diagnosticPublications().length;
    await harness.client.sendNotification(refreshDiagnosticsNotification, { uri: includedUri });
    const refreshedPublication = await harness.waitForDiagnostics(
      includedUri,
      (diagnostics, publication) =>
        publication.version === 1 && diagnostics.some(({ code }) => code === "LR1001"),
      afterRefresh,
    );
    expect(refreshedPublication.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LR1001",
        range: {
          start: { line: 1, character: 4 },
          end: { line: 1, character: 10 },
        },
      }),
    );
    expect(delays.at(-1)).toBe(150);
  });

  it("refreshes a root when a child of its loaded include directory changes", async () => {
    const rootUri = "file:///workspace/root.conf";
    const directoryUri = "file:///workspace/logrotate.d";
    const childUri = "file:///workspace/logrotate.d/application";
    const files: Record<
      string,
      { text?: string; entries?: readonly string[]; size?: number; mtime?: number; etag?: string }
    > = {
      [directoryUri]: { entries: ["application"] },
      [childUri]: { text: "UNKNOWN\n", size: 8, mtime: 1, etag: "one" },
    };
    harness = await createServerHarness(files);
    await harness.open(rootUri, "logrotate", "include logrotate.d\n");
    const loaded = await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri);
    expect(loaded.resources).toEqual([
      { uri: directoryUri, type: "directory" },
      { uri: childUri, type: "file" },
    ]);

    files[childUri] = { text: "daily\n", size: 6, mtime: 2, etag: "two" };
    const after = harness.loadedIncludeNotifications().length;
    await harness.client.sendNotification(includedResourceChangedNotification, { uri: childUri });
    await harness.waitForLoadedIncludes(({ rootUri: root }) => root === rootUri, after);

    expect(harness.fileReadCount(childUri)).toBe(2);
    expect(
      await harness.waitForDiagnostics(childUri, (diagnostics) => diagnostics.length === 0),
    ).toMatchObject({ uri: childUri, diagnostics: [] });
  });
});
