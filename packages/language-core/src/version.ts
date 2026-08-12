import { latestVersion, supportedVersions, versionByNumber } from "./generated/versions.js";
import type {
  ResolvedTargetVersion,
  TargetVersionDetection,
  TargetVersionSetting,
} from "./types.js";

export { latestVersion, supportedVersions, versionByNumber };

export function resolveTargetVersion(
  requested: TargetVersionSetting = "latest",
  detection: TargetVersionDetection = { allowed: false },
): ResolvedTargetVersion {
  if (requested === "latest") {
    return resolvedKnown(requested, latestVersion, "latest");
  }
  if (requested === "auto") {
    const detected = detection.allowed ? normalizeDetectedVersion(detection.version) : undefined;
    return detected === undefined
      ? resolvedKnown(requested, latestVersion, "latest")
      : resolvedKnown(requested, detected, "detected");
  }
  const definition = versionByNumber.get(requested);
  return definition === undefined
    ? { requested, version: requested, source: "explicit", known: false }
    : { requested, version: requested, source: "explicit", known: true, definition };
}

function resolvedKnown(
  requested: TargetVersionSetting,
  version: string,
  source: "latest" | "detected",
): ResolvedTargetVersion {
  const definition = versionByNumber.get(version);
  if (definition === undefined) {
    throw new Error(`Generated target version ${version} is not registered.`);
  }
  return { requested, version, source, known: true, definition };
}

function normalizeDetectedVersion(version: string | undefined): string | undefined {
  const match = /^(\d+\.\d+)(?:\.\d+)?(?:\D.*)?$/u.exec(version?.trim() ?? "");
  const normalized = match?.[1];
  return normalized !== undefined && versionByNumber.has(normalized) ? normalized : undefined;
}
