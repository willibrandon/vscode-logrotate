import { describe, expect, it, vi } from "vitest";
import {
  validateWithInstalledLogrotate,
  type ProcessHost,
  type ProcessResult,
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

describe("installed logrotate validator", () => {
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
      ["--debug", "--state", "/dev/null", "/workspace/config/logrotate.conf"],
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
});
