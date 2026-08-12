import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export interface ProcessLimits {
  readonly timeoutMilliseconds: number;
  readonly maxOutputBytes: number;
}

export interface ProcessHost {
  run(
    executable: string,
    arguments_: readonly string[],
    limits: ProcessLimits,
  ): Promise<ProcessResult>;
}

export interface ExternalValidationResult {
  readonly version: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

const defaultLimits: ProcessLimits = {
  timeoutMilliseconds: 10_000,
  maxOutputBytes: 256 * 1024,
};

export async function validateWithInstalledLogrotate(
  executable: string,
  configurationPath: string,
  processHost: ProcessHost,
  limits: ProcessLimits = defaultLimits,
): Promise<ExternalValidationResult> {
  const versionResult = await processHost.run(executable, ["--version"], limits);
  const version =
    /logrotate\s+([^\s]+)/u.exec(`${versionResult.stdout}\n${versionResult.stderr}`)?.[1] ??
    "unknown";
  const result = await processHost.run(
    executable,
    ["--debug", "--state", nullStatePath(), configurationPath],
    limits,
  );
  return { version, ...result };
}

export class NodeProcessHost implements ProcessHost {
  public run(
    executable: string,
    arguments_: readonly string[],
    limits: ProcessLimits,
  ): Promise<ProcessResult> {
    return new Promise((resolvePromise, rejectPromise): void => {
      const options: SpawnOptionsWithoutStdio = {
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      };
      const child = spawn(executable, [...arguments_], options);
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let truncated = false;
      let settled = false;

      const collect = (current: string, chunk: Uint8Array): string => {
        if (truncated) return current;
        const remaining = limits.maxOutputBytes - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          terminate(child);
          return current;
        }
        const bytes = chunk.subarray(0, remaining);
        outputBytes += bytes.byteLength;
        if (bytes.byteLength < chunk.byteLength) {
          truncated = true;
          terminate(child);
        }
        return `${current}${new TextDecoder().decode(bytes)}`;
      };

      child.stdout.on("data", (chunk: Uint8Array): void => {
        stdout = collect(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Uint8Array): void => {
        stderr = collect(stderr, chunk);
      });

      const timeout = setTimeout((): void => {
        terminate(child);
      }, limits.timeoutMilliseconds);
      timeout.unref();

      child.once("error", (error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.once("close", (exitCode, signal): void => {
        if (settled) return;
        settled = true;
        const timedOut = child.killed && !truncated;
        clearTimeout(timeout);
        resolvePromise({ exitCode, signal, stdout, stderr, timedOut, truncated });
      });
    });
  }
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const force = setTimeout((): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 500);
  force.unref();
}

function nullStatePath(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}
