import type {
  CoreDiagnostic,
  DirectiveNode,
  DocumentNode,
  ParsedDocument,
  RotationBlockNode,
} from "./model.js";

export function analyze(document: ParsedDocument): readonly CoreDiagnostic[] {
  const diagnostics: CoreDiagnostic[] = [...document.diagnostics];
  analyzeSequence(document.children, diagnostics);
  return diagnostics;
}

function analyzeSequence(nodes: readonly DocumentNode[], diagnostics: CoreDiagnostic[]): void {
  const directives = collectDirectives(nodes);
  const effective = new Map<string, DirectiveNode>();
  for (const directive of directives) {
    effective.set(directive.name, directive);
  }
  warnPrerequisite(
    diagnostics,
    effective,
    "delaycompress",
    "compress",
    "LR2002",
    "delaycompress has no effect unless compression is enabled.",
  );
  for (const name of ["dateformat", "dateyesterday", "datehourago"]) {
    warnPrerequisite(
      diagnostics,
      effective,
      name,
      "dateext",
      "LR2003",
      `${name} has no effect unless date extensions are enabled.`,
    );
  }
  for (const name of ["mailfirst", "maillast"]) {
    warnPrerequisite(
      diagnostics,
      effective,
      name,
      "mail",
      "LR2004",
      `${name} has no effect without a mail address.`,
    );
  }
  warnPrerequisite(
    diagnostics,
    effective,
    "shredcycles",
    "shred",
    "LR2005",
    "shredcycles has no effect unless shredding is enabled.",
  );
  const create = effective.get("create");
  const copy = effective.get("copy") ?? effective.get("copytruncate");
  if (create !== undefined && copy !== undefined) {
    diagnostics.push({
      code: "LR2006",
      severity: "warning",
      message: `create has no effect while ${copy.name} is enabled.`,
      source: "logrotate",
      start: create.nameSpan.start,
      end: create.nameSpan.end,
      related: [copy.nameSpan],
    });
  }
  const copyModes = ["copy", "copytruncate", "renamecopy"]
    .map((name) => effective.get(name))
    .filter((directive): directive is DirectiveNode => directive !== undefined);
  if (copyModes.length > 1) {
    const last = copyModes.at(-1);
    if (last !== undefined) {
      diagnostics.push({
        code: "LR2007",
        severity: "warning",
        message: `Multiple copy modes are configured; ${last.name} is the effective choice.`,
        source: "logrotate",
        start: last.nameSpan.start,
        end: last.nameSpan.end,
        related: copyModes.slice(0, -1).map(({ nameSpan }) => nameSpan),
      });
    }
  }
  for (const node of nodes) {
    if (node.kind === "rotation-block") {
      analyzeSequence(node.children, diagnostics);
    }
  }
}

function collectDirectives(nodes: readonly DocumentNode[]): DirectiveNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "directive") {
      return [node];
    }
    if (node.kind === "include") {
      return [node.directive];
    }
    if (node.kind === "script") {
      return [node.starter, ...(node.terminator === undefined ? [] : [node.terminator])];
    }
    return [];
  });
}

function warnPrerequisite(
  diagnostics: CoreDiagnostic[],
  effective: ReadonlyMap<string, DirectiveNode>,
  dependentName: string,
  prerequisiteName: string,
  code: string,
  message: string,
): void {
  const dependent = effective.get(dependentName);
  const prerequisite = effective.get(prerequisiteName);
  const disabled = effective.has(`no${prerequisiteName}`);
  if (dependent !== undefined && (prerequisite === undefined || disabled)) {
    diagnostics.push({
      code,
      severity: "warning",
      message,
      source: "logrotate",
      start: dependent.nameSpan.start,
      end: dependent.nameSpan.end,
    });
  }
}

export function rotationBlocks(document: ParsedDocument): readonly RotationBlockNode[] {
  return document.children.filter(
    (node): node is RotationBlockNode => node.kind === "rotation-block",
  );
}
