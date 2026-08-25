export function requireLinuxDockerEngine(output) {
  const operatingSystem = output.trim().toLowerCase();
  if (operatingSystem !== "linux") {
    throw new Error(
      `The Remote SSH smoke test requires Docker's Linux engine; Docker reported ${JSON.stringify(operatingSystem || "unknown")}.`,
    );
  }
}

export function createRemoteCodeLaunch(platform, executable, arguments_) {
  if (platform === "linux") {
    return {
      command: "xvfb-run",
      arguments: ["-a", executable, "--no-sandbox", "--disable-gpu-sandbox", ...arguments_],
    };
  }

  return { command: executable, arguments: [...arguments_] };
}

export function createRemoteCodeServerReadiness(container, commit) {
  const directory = `/home/vscode/.vscode-server/bin/${commit}`;
  const executable = `${directory}/bin/code-server`;
  return {
    executable,
    arguments: ["exec", container, "test", "-x", `${directory}/node`, "-a", "-x", executable],
  };
}

export function sshNullDevice(platform) {
  return platform === "win32" ? "NUL" : "/dev/null";
}

export function sshConfigPath(path) {
  return `"${path.replaceAll("\\", "/").replaceAll('"', '\\"')}"`;
}
