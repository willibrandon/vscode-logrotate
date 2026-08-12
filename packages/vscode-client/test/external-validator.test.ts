import { describe, expect, it, vi } from "vitest";
import {
  detectInstalledLogrotateVersion,
  externalValidationSummary,
  NodeProcessHost,
  processPlatformPolicy,
  terminateProcessTree,
  validateWithInstalledLogrotate,
  type ProcessHost,
  type ProcessResult,
  type ProcessTreeChild,
  type ProcessTreeHost,
} from "../src/external-validator.js";

const success: ProcessResult = {
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  timedOut: false,
  truncated: false,
  cancelled: false,
};
const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";

describe("installed logrotate validator", () => {
  it("detects a version with one bounded no-shell probe and rechecks trust", async () => {
    let trusted = true;
    const run = vi
      .fn<ProcessHost["run"]>()
      .mockResolvedValue({ ...success, stdout: "logrotate 3.22.0\n" });

    await expect(
      detectInstalledLogrotateVersion("/opt/logrotate", { run }, { isTrusted: () => trusted }),
    ).resolves.toBe("3.22.0");
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      "/opt/logrotate",
      ["--version"],
      { timeoutMilliseconds: 5_000, maxOutputBytes: 64 * 1024 },
      {},
    );

    trusted = false;
    await expect(
      detectInstalledLogrotateVersion("/opt/logrotate", { run }, { isTrusted: () => trusted }),
    ).rejects.toThrow("trust was revoked");
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "failed", result: { exitCode: 1 } },
    { name: "timed out", result: { timedOut: true } },
    { name: "truncated", result: { truncated: true } },
    { name: "cancelled", result: { cancelled: true } },
  ])("falls back when version detection is $name", async ({ result }) => {
    const run = vi
      .fn<ProcessHost["run"]>()
      .mockResolvedValue({ ...success, stdout: "logrotate 3.22.0\n", ...result });
    await expect(detectInstalledLogrotateVersion("logrotate", { run })).resolves.toBeUndefined();
  });

  it("uses exact argv, an isolated state, a containing cwd, and never a shell string", async () => {
    const run = vi
      .fn<ProcessHost["run"]>()
      .mockResolvedValueOnce({ ...success, stdout: "logrotate 3.22.0\n" })
      .mockResolvedValueOnce(success);
    const result = await validateWithInstalledLogrotate(
      "/opt/logrotate",
      "/workspace/config/logrotate.conf",
      { run },
    );
    expect(run).toHaveBeenNthCalledWith(
      1,
      "/opt/logrotate",
      ["--version"],
      expect.objectContaining({ timeoutMilliseconds: 10_000, maxOutputBytes: 262_144 }),
      { cwd: "/workspace/config" },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "/opt/logrotate",
      ["--debug", "--state", nullDevice, "/workspace/config/logrotate.conf"],
      expect.any(Object),
      { cwd: "/workspace/config" },
    );
    expect(result.version).toBe("3.22.0");
  });

  it("rechecks trust immediately before each process run", async () => {
    let checks = 0;
    const run = vi
      .fn<ProcessHost["run"]>()
      .mockResolvedValueOnce({ ...success, stdout: "logrotate 3.22.0\n" });
    await expect(
      validateWithInstalledLogrotate("logrotate", "/workspace/logrotate.conf", { run }, undefined, {
        isTrusted: () => {
          checks += 1;
          return checks === 1;
        },
      }),
    ).rejects.toThrow("trust was revoked");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not start after cancellation and propagates midflight cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn<ProcessHost["run"]>();
    await expect(
      validateWithInstalledLogrotate("logrotate", "/workspace/logrotate.conf", { run }, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
    expect(run).not.toHaveBeenCalled();

    run.mockResolvedValueOnce({ ...success, cancelled: true });
    const result = await validateWithInstalledLogrotate("logrotate", "/workspace/logrotate.conf", {
      run,
    });
    expect(result).toMatchObject({ version: "unknown", cancelled: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown version when the binary emits no version marker", async () => {
    const run = vi.fn<ProcessHost["run"]>().mockResolvedValue(success);
    const result = await validateWithInstalledLogrotate("logrotate", "/workspace/logrotate.conf", {
      run,
    });
    expect(result.version).toBe("unknown");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports the first actionable host warning instead of logrotate's debug-mode notice", () => {
    expect(
      externalValidationSummary({
        ...success,
        version: "3.22.0",
        exitCode: 1,
        stderr: [
          "warning: logrotate in debug mode does nothing except printing debug messages!",
          "warning: included.conf:2 unknown option 'rotote' -- ignoring line",
          "error: stat of /var/log/included.log failed: No such file or directory",
        ].join("\n"),
      }),
    ).toBe("warning: included.conf:2 unknown option 'rotote' -- ignoring line");
  });

  it("forwards a live cancellation signal to both process invocations", async () => {
    const controller = new AbortController();
    const run = vi.fn<ProcessHost["run"]>().mockResolvedValue(success);
    await validateWithInstalledLogrotate(
      "logrotate",
      "/workspace/logrotate.conf",
      { run },
      undefined,
      { signal: controller.signal },
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((call) => call[3]?.signal === controller.signal)).toBe(true);
  });
});

describe("Node process host", () => {
  const host = new NodeProcessHost();
  const generous = { timeoutMilliseconds: 2_000, maxOutputBytes: 16 * 1024 };

  it("returns without spawning for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      host.run(process.execPath, ["-e", "process.exit(99)"], generous, {
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ cancelled: true, exitCode: null });
  });

  it("decodes split UTF-8 on both streams and preserves the exit status", async () => {
    const program = [
      "const out = Buffer.from('😀');",
      "const err = Buffer.from('é');",
      "process.stdout.write(out.subarray(0, 2));",
      "process.stderr.write(err.subarray(0, 1));",
      "setTimeout(() => {",
      "  process.stdout.write(out.subarray(2));",
      "  process.stderr.write(err.subarray(1));",
      "}, 5);",
    ].join("\n");
    await expect(
      host.run(process.execPath, ["-e", program], generous, { cwd: process.cwd() }),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "😀",
      stderr: "é",
      truncated: false,
      timedOut: false,
      cancelled: false,
    });
  });

  it("terminates output floods at the combined byte limit", async () => {
    const result = await host.run(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(65536)); setInterval(() => {}, 1000)"],
      { timeoutMilliseconds: 2_000, maxOutputBytes: 32 },
    );
    expect(result).toMatchObject({ truncated: true, timedOut: false, cancelled: false });
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      32,
    );
  });

  it("does not collect output when the configured byte budget is zero", async () => {
    const result = await host.run(
      process.execPath,
      ["-e", "process.stdout.write('never collected'); setInterval(() => {}, 1000)"],
      { timeoutMilliseconds: 2_000, maxOutputBytes: 0 },
    );
    expect(result).toMatchObject({ stdout: "", stderr: "", truncated: true, timedOut: false });
  });

  it("terminates timed-out and cancelled child processes", async () => {
    const timedOut = await host.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMilliseconds: 20,
      maxOutputBytes: 1024,
    });
    expect(timedOut).toMatchObject({ timedOut: true, cancelled: false });

    const controller = new AbortController();
    const pending = host.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], generous, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).resolves.toMatchObject({ cancelled: true, timedOut: false });
  });

  it.skipIf(process.platform === "win32")(
    "force-kills a process tree that ignores graceful termination",
    async () => {
      const result = await host.run(
        process.execPath,
        [
          "-e",
          "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
        ],
        { timeoutMilliseconds: 500, maxOutputBytes: 1024 },
      );
      expect(result).toMatchObject({
        stdout: "ready",
        signal: "SIGKILL",
        timedOut: true,
        truncated: false,
        cancelled: false,
      });
    },
  );

  it("rejects process creation errors", async () => {
    await expect(
      host.run("definitely-not-a-real-logrotate-test-executable", [], generous),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("process platform and tree policy", () => {
  it("selects native Windows and Unix process behavior without depending on the test host", () => {
    expect(processPlatformPolicy("win32")).toEqual({
      detached: false,
      nullStatePath: "NUL",
    });
    expect(processPlatformPolicy("linux")).toEqual({
      detached: true,
      nullStatePath: "/dev/null",
    });
  });

  it("terminates a detached process group gracefully and then forcefully", () => {
    const child = processTreeChild(42);
    const { host, killProcessGroup, scheduled, unref } = processTreeHost();

    terminateProcessTree(child, true, host);

    expect(killProcessGroup).toHaveBeenNthCalledWith(1, -42, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
    expect(unref).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(killProcessGroup).toHaveBeenNthCalledWith(2, -42, "SIGKILL");
  });

  it("falls back to the child handle and does not signal an exited process", () => {
    const child = processTreeChild(42);
    const controls = processTreeHost();
    controls.killProcessGroup.mockImplementation((): never => {
      throw new Error("group exited");
    });

    terminateProcessTree(child, true, controls.host);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    child.signalCode = "SIGTERM";
    controls.scheduled[0]?.();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(controls.killProcessGroup).toHaveBeenCalledOnce();

    const exited = processTreeChild();
    exited.exitCode = 0;
    terminateProcessTree(exited, false, controls.host);
    expect(exited.kill).not.toHaveBeenCalled();

    const signalled = processTreeChild();
    signalled.signalCode = "SIGTERM";
    terminateProcessTree(signalled, false, controls.host);
    expect(signalled.kill).not.toHaveBeenCalled();
  });

  it("uses the child handle when process-group signaling is unavailable", () => {
    const child = processTreeChild();
    const controls = processTreeHost();

    terminateProcessTree(child, false, controls.host);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    controls.scheduled[0]?.();
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(controls.killProcessGroup).not.toHaveBeenCalled();
  });
});

function processTreeChild(pid?: number): ProcessTreeChild & {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn<(signal: NodeJS.Signals) => boolean>>;
} {
  return {
    exitCode: null,
    pid,
    signalCode: null,
    kill: vi.fn(() => true),
  };
}

function processTreeHost(): {
  readonly host: ProcessTreeHost;
  readonly killProcessGroup: ReturnType<
    typeof vi.fn<(pid: number, signal: NodeJS.Signals) => void>
  >;
  readonly scheduled: (() => void)[];
  readonly unref: ReturnType<typeof vi.fn<() => void>>;
} {
  const killProcessGroup = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const scheduled: (() => void)[] = [];
  const unref = vi.fn<() => void>();
  return {
    host: {
      killProcessGroup,
      setTimeout(callback, milliseconds): { unref(): void } {
        expect(milliseconds).toBe(500);
        scheduled.push(callback);
        return { unref };
      },
    },
    killProcessGroup,
    scheduled,
    unref,
  };
}
