export type DetectedLogrotateLanguage = "logrotate" | "logrotate-state";

const maximumFirstLineLength = 8192;
const configurationHeader =
  /^\s*(?:"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+'|(?:\/|~\/)(?:[^\s{}#\\]|\\.)+)(?:\s+(?:"(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)+'|(?:\/|~\/)(?:[^\s{}#\\]|\\.)+))*\s*\{\s*(?:#.*)?$/u;
const stateHeader = /^logrotate state -- version [12]$/u;

export function detectLogrotateLanguage(firstLine: string): DetectedLogrotateLanguage | undefined {
  if (firstLine.length > maximumFirstLineLength) return undefined;
  if (stateHeader.test(firstLine)) return "logrotate-state";
  return configurationHeader.test(firstLine) ? "logrotate" : undefined;
}
