import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { dirname } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly cancelled: boolean;
}

export interface ProcessLimits {
  readonly timeoutMilliseconds: number;
  readonly maxOutputBytes: number;
}

export interface ProcessRunOptions {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
}

export interface ProcessHost {
  run(
    executable: string,
    arguments_: readonly string[],
    limits: ProcessLimits,
    options?: ProcessRunOptions,
  ): Promise<ProcessResult>;
}

export interface ExternalValidationResult {
  readonly version: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly cancelled: boolean;
}

export interface ExternalValidationOptions {
  readonly signal?: AbortSignal;
  readonly isTrusted?: () => boolean;
}

export function externalValidationSummary(result: ExternalValidationResult): string {
  if (result.timedOut) return "Installed logrotate validation timed out.";
  if (result.truncated) return "Installed logrotate validation exceeded its output limit.";
  const output = `${result.stderr}\n${result.stdout}`.trim();
  const firstActionableLine = output
    .split(/\r\n|\n|\r/u)
    .find(
      (line) =>
        /error|warning/iu.test(line) &&
        !/warning:\s*logrotate in debug mode does nothing/iu.test(line),
    );
  return (
    firstActionableLine ?? `Installed logrotate exited with code ${result.exitCode ?? "unknown"}.`
  );
}

const defaultLimits: ProcessLimits = {
  timeoutMilliseconds: 10_000,
  maxOutputBytes: 256 * 1024,
};

const versionDetectionLimits: ProcessLimits = {
  timeoutMilliseconds: 5_000,
  maxOutputBytes: 64 * 1024,
};

export async function detectInstalledLogrotateVersion(
  executable: string,
  processHost: ProcessHost,
  options: ExternalValidationOptions = {},
): Promise<string | undefined> {
  assertExecutableAllowed(options);
  const result = await processHost.run(executable, ["--version"], versionDetectionLimits, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.cancelled || result.timedOut || result.truncated || result.exitCode !== 0) {
    return undefined;
  }
  return logrotateVersion(result);
}

export async function validateWithInstalledLogrotate(
  executable: string,
  configurationPath: string,
  processHost: ProcessHost,
  limits: ProcessLimits = defaultLimits,
  options: ExternalValidationOptions = {},
): Promise<ExternalValidationResult> {
  assertExecutableAllowed(options);
  const runOptions: ProcessRunOptions = {
    cwd: dirname(configurationPath),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const versionResult = await processHost.run(executable, ["--version"], limits, runOptions);
  if (versionResult.cancelled) return { version: "unknown", ...versionResult };
  const version = logrotateVersion(versionResult) ?? "unknown";
  assertExecutableAllowed(options);
  const result = await processHost.run(
    executable,
    ["--debug", "--state", nullStatePath(), configurationPath],
    limits,
    runOptions,
  );
  return { version, ...result };
}

function logrotateVersion(result: ProcessResult): string | undefined {
  return /(?:^|\s)logrotate\s+([^\s]+)/iu.exec(`${result.stdout}\n${result.stderr}`)?.[1];
}

export class NodeProcessHost implements ProcessHost {
  public run(
    executable: string,
    arguments_: readonly string[],
    limits: ProcessLimits,
    runOptions: ProcessRunOptions = {},
  ): Promise<ProcessResult> {
    return new Promise((resolvePromise, rejectPromise): void => {
      if (runOptions.signal?.aborted === true) {
        resolvePromise({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          cancelled: true,
        });
        return;
      }
      const detached = process.platform !== "win32";
      const options: SpawnOptionsWithoutStdio = {
        shell: false,
        windowsHide: true,
        stdio: "pipe",
        detached,
        ...(runOptions.cwd === undefined ? {} : { cwd: runOptions.cwd }),
      };
      const child = spawn(executable, [...arguments_], options);
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const collect = (current: string, chunk: Uint8Array, decoder: StringDecoder): string => {
        if (truncated) return current;
        const remaining = Math.max(0, limits.maxOutputBytes - outputBytes);
        if (remaining === 0) {
          truncated = true;
          terminateTree(child, detached);
          return current;
        }
        const bytes = chunk.subarray(0, remaining);
        outputBytes += bytes.byteLength;
        if (bytes.byteLength < chunk.byteLength) {
          truncated = true;
          terminateTree(child, detached);
        }
        return `${current}${decoder.write(Buffer.from(bytes))}`;
      };

      child.stdout.on("data", (chunk: Buffer): void => {
        stdout = collect(stdout, chunk, stdoutDecoder);
      });
      child.stderr.on("data", (chunk: Buffer): void => {
        stderr = collect(stderr, chunk, stderrDecoder);
      });

      const timeout = setTimeout(
        (): void => {
          timedOut = true;
          terminateTree(child, detached);
        },
        Math.max(1, limits.timeoutMilliseconds),
      );
      timeout.unref();

      const abort = (): void => {
        cancelled = true;
        terminateTree(child, detached);
      };
      runOptions.signal?.addEventListener("abort", abort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timeout);
        runOptions.signal?.removeEventListener("abort", abort);
      };
      child.once("error", (error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectPromise(error);
      });
      child.once("close", (exitCode, signal): void => {
        if (settled) return;
        settled = true;
        cleanup();
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        resolvePromise({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          truncated,
          cancelled,
        });
      });
    });
  }
}

function assertExecutableAllowed(options: ExternalValidationOptions): void {
  if (options.signal?.aborted === true) throw new Error("Installed validation was cancelled.");
  if (options.isTrusted?.() === false) {
    throw new Error("Workspace trust was revoked before installed validation could run.");
  }
}

function terminateTree(child: ChildProcessWithoutNullStreams, detached: boolean): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcess(child, detached, "SIGTERM");
  const force = setTimeout((): void => {
    if (child.exitCode === null && child.signalCode === null) {
      signalProcess(child, detached, "SIGKILL");
    }
  }, 500);
  force.unref();
}

function signalProcess(
  child: ChildProcessWithoutNullStreams,
  detached: boolean,
  signal: NodeJS.Signals,
): void {
  if (detached && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the status check and group signal.
    }
  }
  child.kill(signal);
}

function nullStatePath(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}
