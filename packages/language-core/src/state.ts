import { decodeArguments } from "./arguments.js";
import type {
  CoreDiagnostic,
  ParsedStateDocument,
  StateRecord,
  ValidationOptions,
} from "./model.js";
import { SourceMap } from "./source-map.js";

export function parseState(source: string, options: ValidationOptions = {}): ParsedStateDocument {
  const map = new SourceMap(source);
  const diagnostics: CoreDiagnostic[] = [];
  const records: StateRecord[] = [];
  const header = map.lines[0];
  let version: 1 | 2 | undefined;
  if (header !== undefined) {
    const headerText = source.slice(header.start, header.contentEnd);
    const match = /^logrotate state -- version ([12])$/u.exec(headerText);
    if (match === null) {
      diagnostics.push(
        stateDiagnostic(
          "LRS1001",
          "Expected a logrotate state version 1 or 2 header.",
          header.start,
          header.contentEnd,
        ),
      );
    } else {
      version = Number(match[1]) as 1 | 2;
    }
  }
  for (const line of map.lines.slice(1)) {
    if (options.cancelled?.() === true || diagnostics.length >= (options.maxProblems ?? 100)) {
      break;
    }
    const content = source.slice(line.start, line.contentEnd);
    if (content.trim() === "" || content.trimStart().startsWith("#")) {
      continue;
    }
    const decoded = decodeArguments(content);
    const path = decoded.arguments[0];
    const timestamp = decoded.arguments[1];
    if (path === undefined || timestamp === undefined || decoded.arguments.length !== 2) {
      diagnostics.push(
        stateDiagnostic(
          "LRS1002",
          "Expected a quoted path followed by one timestamp.",
          line.start,
          line.contentEnd,
        ),
      );
      continue;
    }
    if (!path.quoted) {
      diagnostics.push(
        stateDiagnostic(
          "LRS1003",
          "State record paths must be quoted.",
          line.start + path.start,
          line.start + path.end,
        ),
      );
    }
    const stamp = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:-(\d{1,2}):(\d{1,2}):(\d{1,2}))?$/u.exec(
      timestamp.value,
    );
    if (stamp === null) {
      diagnostics.push(
        stateDiagnostic(
          "LRS1004",
          "The state timestamp is malformed.",
          line.start + timestamp.start,
          line.start + timestamp.end,
        ),
      );
      continue;
    }
    const fields = [stamp[1], stamp[2], stamp[3], stamp[4], stamp[5], stamp[6]].map((value) =>
      value === undefined ? undefined : Number.parseInt(value, 10),
    );
    const [year, month, day, hour, minute, second] = fields;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      !validDateFields(month, day, hour, minute, second)
    ) {
      diagnostics.push(
        stateDiagnostic(
          "LRS1005",
          "The state timestamp contains an out-of-range field.",
          line.start + timestamp.start,
          line.start + timestamp.end,
        ),
      );
      continue;
    }
    records.push({
      start: line.start,
      end: line.end,
      path: path.value,
      pathSpan: { start: line.start + path.start, end: line.start + path.end },
      year,
      month,
      day,
      ...(hour === undefined ? {} : { hour }),
      ...(minute === undefined ? {} : { minute }),
      ...(second === undefined ? {} : { second }),
    });
  }
  return {
    kind: "state-document",
    source,
    start: 0,
    end: source.length,
    ...(version === undefined ? {} : { version }),
    records,
    diagnostics,
  };
}

function validDateFields(
  month: number,
  day: number,
  hour?: number,
  minute?: number,
  second?: number,
): boolean {
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    (hour === undefined || (hour >= 0 && hour <= 23)) &&
    (minute === undefined || (minute >= 0 && minute <= 59)) &&
    (second === undefined || (second >= 0 && second <= 59))
  );
}

function stateDiagnostic(
  code: string,
  message: string,
  start: number,
  end: number,
): CoreDiagnostic {
  return { code, message, severity: "error", source: "logrotate-state", start, end };
}
