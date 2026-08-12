import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  includedResourceChangedNotification,
  loadedIncludesNotification,
} from "@logrotate/language-server/protocol";

const vscodeMock = vi.hoisted(() => {
  class FakeUri {
    readonly #url: URL;

    public constructor(value: string) {
      this.#url = new URL(value);
    }

    public get scheme(): string {
      return this.#url.protocol.slice(0, -1);
    }

    public get path(): string {
      return decodeURIComponent(this.#url.pathname);
    }

    public get fsPath(): string {
      return decodeURIComponent(this.#url.pathname);
    }

    public toString(): string {
      return this.#url.toString();
    }
  }

  class FakeRelativePattern {
    public readonly base: FakeUri | string;
    public readonly pattern: string;

    public constructor(base: FakeUri | string, pattern: string) {
      this.base = base;
      this.pattern = pattern;
    }
  }

  class FakeWatcher {
    readonly #createListeners: ((uri: FakeUri) => void)[] = [];
    readonly #changeListeners: ((uri: FakeUri) => void)[] = [];
    readonly #deleteListeners: ((uri: FakeUri) => void)[] = [];
    public readonly pattern: FakeRelativePattern | string;
    public disposeCount = 0;
    public listenerDisposeCount = 0;

    public constructor(pattern: FakeRelativePattern | string) {
      this.pattern = pattern;
    }

    public onDidCreate(listener: (uri: FakeUri) => void): { dispose(): void } {
      this.#createListeners.push(listener);
      return this.listenerSubscription(this.#createListeners, listener);
    }

    public onDidChange(listener: (uri: FakeUri) => void): { dispose(): void } {
      this.#changeListeners.push(listener);
      return this.listenerSubscription(this.#changeListeners, listener);
    }

    public onDidDelete(listener: (uri: FakeUri) => void): { dispose(): void } {
      this.#deleteListeners.push(listener);
      return this.listenerSubscription(this.#deleteListeners, listener);
    }

    public fire(kind: "create" | "change" | "delete", uri: string): void {
      const listeners =
        kind === "create"
          ? this.#createListeners
          : kind === "change"
            ? this.#changeListeners
            : this.#deleteListeners;
      const parsed = new FakeUri(uri);
      for (const listener of listeners) listener(parsed);
    }

    public dispose(): void {
      this.disposeCount += 1;
      this.#createListeners.length = 0;
      this.#changeListeners.length = 0;
      this.#deleteListeners.length = 0;
    }

    private listenerSubscription(
      listeners: ((uri: FakeUri) => void)[],
      listener: (uri: FakeUri) => void,
    ): { dispose(): void } {
      return {
        dispose: (): void => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
          this.listenerDisposeCount += 1;
        },
      };
    }
  }

  const watchers: FakeWatcher[] = [];
  let rejectedWatcherPattern: string | undefined;
  return {
    FakeRelativePattern,
    FakeUri,
    watchers,
    rejectWatcherPattern(pattern: string | undefined): void {
      rejectedWatcherPattern = pattern;
    },
    module: {
      Uri: {
        parse(value: string): FakeUri {
          return new FakeUri(value);
        },
        joinPath(base: FakeUri, ...paths: string[]): FakeUri {
          const suffix = paths.map((part) => encodeURI(part)).join("/");
          return new FakeUri(new URL(suffix, base.toString().replace(/\/?$/u, "/")).toString());
        },
      },
      RelativePattern: FakeRelativePattern,
      workspace: {
        createFileSystemWatcher(pattern: FakeRelativePattern | string): FakeWatcher {
          if (
            rejectedWatcherPattern !== undefined &&
            (pattern instanceof FakeRelativePattern ? pattern.pattern : pattern).includes(
              rejectedWatcherPattern,
            )
          ) {
            throw new Error("watcher creation rejected");
          }
          const watcher = new FakeWatcher(pattern);
          watchers.push(watcher);
          return watcher;
        },
      },
    },
  };
});

vi.mock("vscode", () => vscodeMock.module);

interface NotificationLike {
  readonly method: string;
}

class FakeLanguageClient {
  readonly #handlers = new Map<string, (params: unknown) => void>();
  public readonly sent: { readonly method: string; readonly params: unknown }[] = [];
  public notificationSubscriptionDisposeCount = 0;
  public nextSendError: Error | undefined;

  public onNotification(
    type: NotificationLike,
    handler: (params: unknown) => void,
  ): { dispose(): void } {
    this.#handlers.set(type.method, handler);
    return {
      dispose: (): void => {
        this.notificationSubscriptionDisposeCount += 1;
        this.#handlers.delete(type.method);
      },
    };
  }

  public sendNotification(type: NotificationLike, params: unknown): Promise<void> {
    this.sent.push({ method: type.method, params });
    if (this.nextSendError !== undefined) {
      const error = this.nextSendError;
      this.nextSendError = undefined;
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  public receive(type: NotificationLike, params: unknown): void {
    this.#handlers.get(type.method)?.(params);
  }
}

describe("loaded include watching", () => {
  beforeEach(() => {
    vscodeMock.watchers.length = 0;
    vscodeMock.rejectWatcherPattern(undefined);
  });

  it("deduplicates shared local resources, ignores virtual resources, refreshes every event, and disposes exactly once", async () => {
    const { registerLoadedIncludeWatching } = await import("../src/common.js");
    const client = new FakeLanguageClient();
    const subscriptions: { dispose(): void }[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const context = { subscriptions };
    const runtime = {
      client,
      output: {
        warn(message: string): void {
          warnings.push(message);
        },
        error(message: string): void {
          errors.push(message);
        },
      },
    };
    const first = "file:///etc/logrotate.d/first";
    const second = "file:///etc/logrotate.d/second";
    const third = "file:///etc/logrotate.d/third";
    const directory = "file:///etc/logrotate.d";
    const special = "file:///etc/logrotate.d/name%5Bprod%5D*%3F.conf";

    registerLoadedIncludeWatching(context as never, runtime as never);
    client.receive(loadedIncludesNotification, {
      rootUri: "file:///etc/logrotate.conf",
      resources: [
        { uri: first, type: "file" },
        { uri: directory, type: "directory" },
        { uri: special, type: "file" },
        { uri: "git:/deployment/logrotate.conf?ref=main", type: "file" },
        { uri: "vscode-remote:/etc/logrotate.d/a", type: "file" },
      ],
    });
    expect(vscodeMock.watchers).toHaveLength(3);
    const firstWatcher = vscodeMock.watchers[0];
    const directoryWatcher = vscodeMock.watchers[1];
    const specialWatcher = vscodeMock.watchers[2];
    expect(firstWatcher?.pattern).toMatchObject({ pattern: "first" });
    expect(String((firstWatcher?.pattern as { base?: unknown }).base)).toBe(`${directory}/`);
    expect(directoryWatcher?.pattern).toMatchObject({ pattern: "*" });
    expect(String((directoryWatcher?.pattern as { base?: unknown }).base)).toBe(directory);
    expect(specialWatcher?.pattern).toMatchObject({ pattern: "name[[]prod[]][*][?].conf" });
    expect(String((specialWatcher?.pattern as { base?: unknown }).base)).toBe(`${directory}/`);

    vscodeMock.rejectWatcherPattern("cannot-watch");
    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/unwatchable-root.conf",
      resources: [
        { uri: "file:///etc/logrotate.d/cannot-watch", type: "file" },
        { uri: "not a URI", type: "file" },
      ],
    });
    expect(warnings).toEqual(["Unable to watch included resource: watcher creation rejected"]);
    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/unwatchable-root.conf",
      resources: [],
    });
    vscodeMock.rejectWatcherPattern(undefined);

    directoryWatcher?.fire("create", "file:///etc/logrotate.d/newly-created");
    await Promise.resolve();
    expect(client.sent).toEqual([
      {
        method: includedResourceChangedNotification.method,
        params: { uri: "file:///etc/logrotate.d/newly-created" },
      },
    ]);

    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/root.conf",
      resources: [
        { uri: first, type: "file" },
        { uri: second, type: "file" },
      ],
    });
    expect(vscodeMock.watchers).toHaveLength(4);
    const secondWatcher = vscodeMock.watchers[3];
    expect(firstWatcher).toBeDefined();
    expect(secondWatcher).toBeDefined();

    client.receive(loadedIncludesNotification, {
      rootUri: "file:///etc/logrotate.conf",
      resources: [],
    });
    expect(firstWatcher?.disposeCount).toBe(0);
    expect(secondWatcher?.disposeCount).toBe(0);
    expect(directoryWatcher?.disposeCount).toBe(1);
    expect(specialWatcher?.disposeCount).toBe(1);

    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/root.conf",
      resources: [{ uri: second, type: "file" }],
    });
    expect(firstWatcher?.disposeCount).toBe(1);
    expect(secondWatcher?.disposeCount).toBe(0);

    secondWatcher?.fire("create", second);
    secondWatcher?.fire("change", second);
    secondWatcher?.fire("delete", second);
    await Promise.resolve();
    expect(client.sent.slice(1)).toEqual([
      { method: includedResourceChangedNotification.method, params: { uri: second } },
      { method: includedResourceChangedNotification.method, params: { uri: second } },
      { method: includedResourceChangedNotification.method, params: { uri: second } },
    ]);

    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/root.conf",
      resources: [],
    });
    expect(secondWatcher?.disposeCount).toBe(1);

    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/third-root.conf",
      resources: [{ uri: third, type: "file" }],
    });
    const thirdWatcher = vscodeMock.watchers[4];
    expect(thirdWatcher).toBeDefined();
    client.nextSendError = new Error("refresh rejected");
    thirdWatcher?.fire("change", third);
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual(["Unable to refresh changed included resource: refresh rejected"]);

    const watcherLedger = subscriptions.at(-1);
    watcherLedger?.dispose();
    watcherLedger?.dispose();
    subscriptions[0]?.dispose();
    expect(thirdWatcher?.disposeCount).toBe(1);
    expect(client.notificationSubscriptionDisposeCount).toBe(1);
    client.receive(loadedIncludesNotification, {
      rootUri: "file:///workspace/after-disposal.conf",
      resources: [{ uri: "file:///etc/logrotate.d/after-disposal", type: "file" }],
    });
    expect(vscodeMock.watchers).toHaveLength(5);
    expect(warnings).toEqual(["Unable to watch included resource: watcher creation rejected"]);
  });
});
