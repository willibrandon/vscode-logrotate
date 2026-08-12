import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDirectoryRequest,
  readFileRequest,
  statRequest,
} from "@logrotate/language-server/protocol";

const vscodeMock = vi.hoisted(() => {
  class FakeUri {
    public readonly value: string;

    public constructor(value: string) {
      this.value = value;
    }

    public toString(): string {
      return this.value;
    }
  }

  const reads: string[] = [];
  const listings: string[] = [];
  const stats: string[] = [];
  return {
    reads,
    listings,
    stats,
    module: {
      FileType: { File: 1, Directory: 2 },
      Uri: {
        parse(value: string): FakeUri {
          return new FakeUri(value);
        },
      },
      workspace: {
        fs: {
          readFile(uri: FakeUri): Promise<Uint8Array> {
            reads.push(uri.toString());
            return Promise.resolve(
              uri.value.endsWith("invalid.conf")
                ? new Uint8Array([0xc3, 0x28])
                : new TextEncoder().encode("daily # 😀\n"),
            );
          },
          readDirectory(uri: FakeUri): Promise<readonly [string, number][]> {
            listings.push(uri.toString());
            return Promise.resolve([
              ["application", 1],
              ["nested", 2],
            ]);
          },
          stat(
            uri: FakeUri,
          ): Promise<{ readonly type: number; readonly size: number; readonly mtime: number }> {
            stats.push(uri.toString());
            const type = uri.value.endsWith("directory") ? 2 : uri.value.endsWith("other") ? 64 : 1;
            return Promise.resolve({ type, size: 42, mtime: 1234 });
          },
        },
      },
    },
  };
});

vi.mock("vscode", () => vscodeMock.module);

interface RequestLike {
  readonly method: string;
}

class FakeLanguageClient {
  readonly #handlers = new Map<string, (params: { readonly uri: string }) => unknown>();
  public subscriptionDisposeCount = 0;

  public onRequest(
    type: RequestLike,
    handler: (params: { readonly uri: string }) => unknown,
  ): { dispose(): void } {
    this.#handlers.set(type.method, handler);
    return {
      dispose: (): void => {
        this.subscriptionDisposeCount += 1;
        this.#handlers.delete(type.method);
      },
    };
  }

  public async request<T>(type: RequestLike, uri: string): Promise<T> {
    const handler = this.#handlers.get(type.method);
    if (handler === undefined) throw new Error(`No request handler for ${type.method}`);
    return (await handler({ uri })) as T;
  }
}

describe("VS Code filesystem bridge", () => {
  beforeEach(() => {
    vscodeMock.reads.length = 0;
    vscodeMock.listings.length = 0;
    vscodeMock.stats.length = 0;
  });

  it("reads UTF-8, lists names, classifies resource types, and disposes every handler", async () => {
    const { registerFileSystemBridge } = await import("../src/common.js");
    const client = new FakeLanguageClient();
    const subscriptions: { dispose(): void }[] = [];
    registerFileSystemBridge({ subscriptions } as never, { client } as never);

    await expect(
      client.request<string>(readFileRequest, "memfs:///workspace/logrotate.conf"),
    ).resolves.toBe("daily # 😀\n");
    await expect(
      client.request<readonly string[]>(readDirectoryRequest, "memfs:///workspace/logrotate.d"),
    ).resolves.toEqual(["application", "nested"]);
    await expect(client.request(statRequest, "memfs:///workspace/file")).resolves.toEqual({
      type: "file",
      size: 42,
      mtime: 1234,
    });
    await expect(client.request(statRequest, "memfs:///workspace/directory")).resolves.toEqual({
      type: "directory",
      size: 42,
      mtime: 1234,
    });
    await expect(client.request(statRequest, "memfs:///workspace/other")).resolves.toEqual({
      type: "other",
      size: 42,
      mtime: 1234,
    });
    expect(vscodeMock.reads).toEqual(["memfs:///workspace/logrotate.conf"]);
    expect(vscodeMock.listings).toEqual(["memfs:///workspace/logrotate.d"]);
    expect(vscodeMock.stats).toEqual([
      "memfs:///workspace/file",
      "memfs:///workspace/directory",
      "memfs:///workspace/other",
    ]);

    expect(subscriptions).toHaveLength(3);
    for (const subscription of subscriptions) subscription.dispose();
    expect(client.subscriptionDisposeCount).toBe(3);
  });

  it("rejects malformed UTF-8 instead of silently changing configuration bytes", async () => {
    const { registerFileSystemBridge } = await import("../src/common.js");
    const client = new FakeLanguageClient();
    registerFileSystemBridge({ subscriptions: [] } as never, { client } as never);

    await expect(
      client.request<string>(readFileRequest, "memfs:///workspace/invalid.conf"),
    ).rejects.toThrow();
  });
});
