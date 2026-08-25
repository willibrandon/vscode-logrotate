import { describe, expect, it } from "vitest";

interface RemoteCodeLaunch {
  readonly command: string;
  readonly arguments: string[];
}

interface RemoteSmokeHostModule {
  createRemoteCodeLaunch(
    platform: NodeJS.Platform,
    executable: string,
    arguments_: readonly string[],
  ): RemoteCodeLaunch;
  createRemoteCodeServerReadiness(
    container: string,
    commit: string,
  ): Readonly<{ readonly executable: string; readonly arguments: readonly string[] }>;
  requireLinuxDockerEngine(output: string): void;
  sshConfigPath(path: string): string;
  sshNullDevice(platform: NodeJS.Platform): string;
}

const moduleUrl = new URL("../remote-smoke-host.mjs", import.meta.url);
const host = (await import(moduleUrl.href)) as RemoteSmokeHostModule;

describe("Remote SSH smoke host", () => {
  it("accepts Docker Desktop when its server is running Linux containers", () => {
    expect(() => host.requireLinuxDockerEngine("linux\r\n")).not.toThrow();
    expect(() => host.requireLinuxDockerEngine("windows\n")).toThrow(
      `Docker's Linux engine; Docker reported "windows"`,
    );
    expect(() => host.requireLinuxDockerEngine("\n")).toThrow(
      `Docker's Linux engine; Docker reported "unknown"`,
    );
  });

  it("uses Xvfb only for a Linux VS Code host", () => {
    expect(host.createRemoteCodeLaunch("linux", "/opt/code", ["--new-window"])).toEqual({
      command: "xvfb-run",
      arguments: ["-a", "/opt/code", "--no-sandbox", "--disable-gpu-sandbox", "--new-window"],
    });
    expect(host.createRemoteCodeLaunch("win32", "C:\\VSCode\\Code.exe", ["--new-window"])).toEqual({
      command: "C:\\VSCode\\Code.exe",
      arguments: ["--new-window"],
    });
    expect(host.createRemoteCodeLaunch("darwin", "/Applications/Code", [])).toEqual({
      command: "/Applications/Code",
      arguments: [],
    });
  });

  it("waits for the complete VS Code Server before using code-server", () => {
    const commit = "110a328ea54b42367b803ec53ee0bf52ef26b419";
    const directory = `/home/vscode/.vscode-server/bin/${commit}`;
    expect(host.createRemoteCodeServerReadiness("logrotate-remote", commit)).toEqual({
      executable: `${directory}/bin/code-server`,
      arguments: [
        "exec",
        "logrotate-remote",
        "test",
        "-x",
        `${directory}/node`,
        "-a",
        "-x",
        `${directory}/bin/code-server`,
      ],
    });
  });

  it("writes host-specific null devices and portable quoted SSH paths", () => {
    expect(host.sshNullDevice("win32")).toBe("NUL");
    expect(host.sshNullDevice("linux")).toBe("/dev/null");
    expect(host.sshConfigPath("D:\\Temp Folder\\id_ed25519")).toBe('"D:/Temp Folder/id_ed25519"');
  });
});
