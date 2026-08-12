import { describe, expect, it, vi } from "vitest";

const vscodeMock = vi.hoisted(() => {
  class FakeUri {
    readonly #url: URL;

    public constructor(value: string) {
      this.#url = new URL(value);
    }

    public get scheme(): string {
      return this.#url.protocol.slice(0, -1);
    }

    public get authority(): string {
      return this.#url.host;
    }

    public get path(): string {
      return this.#url.pathname;
    }

    public get query(): string {
      return this.#url.search.slice(1);
    }

    public get fragment(): string {
      return this.#url.hash.slice(1);
    }

    public toString(): string {
      return this.#url.toString();
    }
  }

  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  const opened: string[] = [];
  return {
    handlers,
    opened,
    module: {
      commands: {
        registerCommand(command: string, handler: (...arguments_: unknown[]) => unknown) {
          handlers.set(command, handler);
          return { dispose: vi.fn() };
        },
      },
      env: {
        openExternal(uri: FakeUri): Promise<boolean> {
          opened.push(uri.toString());
          return Promise.resolve(true);
        },
      },
      Uri: {
        parse(value: string): FakeUri {
          return new FakeUri(value);
        },
      },
    },
  };
});

vi.mock("vscode", () => vscodeMock.module);

describe("common extension commands", () => {
  it("opens only reviewed upstream documentation targets", async () => {
    const { registerCommonCommands } = await import("../src/common.js");
    registerCommonCommands(
      { subscriptions: [] } as never,
      {
        client: { stop: vi.fn(), start: vi.fn() },
        output: { info: vi.fn(), show: vi.fn() },
      } as never,
    );
    const openDocumentation = vscodeMock.handlers.get("logrotate.openDirectiveDocumentation");
    expect(openDocumentation).toBeTypeOf("function");

    const pinned =
      "https://github.com/logrotate/logrotate/blob/3be1e9ccffe0c2245ed596183c74913d553f9f18/logrotate.8.in";
    await openDocumentation?.(pinned);
    await openDocumentation?.("https://attacker.example/logrotate.8.in");

    expect(vscodeMock.opened).toEqual([
      pinned,
      "https://github.com/logrotate/logrotate/blob/main/logrotate.8.in",
    ]);
  });
});
