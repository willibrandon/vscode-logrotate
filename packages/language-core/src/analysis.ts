import type {
  CoreDiagnostic,
  DirectiveNode,
  DocumentNode,
  ParsedDocument,
  RotationBlockNode,
} from "./model.js";

export function analyze(document: ParsedDocument): readonly CoreDiagnostic[] {
  const diagnostics: CoreDiagnostic[] = [...document.diagnostics];
  const globals: DirectiveNode[] = [];

  for (const node of document.children) {
    if (node.kind === "directive") {
      globals.push(node);
    } else if (node.kind === "rotation-block") {
      analyzeAssignments([...globals, ...collectDirectives(node.children)], diagnostics);
    }
  }
  analyzeAssignments(globals, diagnostics);
  return diagnostics.slice(0, document.maxProblems);
}

function analyzeAssignments(
  directives: readonly DirectiveNode[],
  diagnostics: CoreDiagnostic[],
): void {
  warnPrerequisite(
    diagnostics,
    directives,
    "delaycompress",
    "compress",
    "LR2002",
    "delaycompress has no effect unless compression is enabled.",
  );
  for (const name of ["dateformat", "dateyesterday", "datehourago"]) {
    warnPrerequisite(
      diagnostics,
      directives,
      name,
      "dateext",
      "LR2003",
      `${name} has no effect unless date extensions are enabled.`,
    );
  }
  for (const name of ["mailfirst", "maillast"]) {
    warnPrerequisite(
      diagnostics,
      directives,
      name,
      "mail",
      "LR2004",
      `${name} has no effect without a mail address.`,
    );
  }
  warnPrerequisite(
    diagnostics,
    directives,
    "shredcycles",
    "shred",
    "LR2005",
    "shredcycles has no effect unless shredding is enabled.",
  );

  const create = activeDirective(directives, "create");
  const copy = latestOf(
    [activeDirective(directives, "copy"), activeDirective(directives, "copytruncate")].filter(
      (directive): directive is DirectiveNode => directive !== undefined,
    ),
  );
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
    .map((name) => activeDirective(directives, name))
    .filter((directive): directive is DirectiveNode => directive !== undefined)
    .sort((left, right) => left.start - right.start);
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
}

function collectDirectives(nodes: readonly DocumentNode[]): DirectiveNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "directive") return [node];
    if (node.kind === "script") return [node.starter];
    return [];
  });
}

function activeDirective(
  directives: readonly DirectiveNode[],
  positiveName: string,
): DirectiveNode | undefined {
  const definition = directives.find(({ name }) => name === positiveName)?.definition;
  const negativeName = definition?.negatedBy;
  const candidates = directives.filter(
    ({ name }) => name === positiveName || (negativeName !== null && name === negativeName),
  );
  const latest = candidates.at(-1);
  return latest?.name === positiveName ? latest : undefined;
}

function latestOf(directives: readonly DirectiveNode[]): DirectiveNode | undefined {
  return directives.reduce<DirectiveNode | undefined>(
    (latest, directive) =>
      latest === undefined || directive.start > latest.start ? directive : latest,
    undefined,
  );
}

function warnPrerequisite(
  diagnostics: CoreDiagnostic[],
  directives: readonly DirectiveNode[],
  dependentName: string,
  prerequisiteName: string,
  code: string,
  message: string,
): void {
  const dependent = activeDirective(directives, dependentName);
  const prerequisite = activeDirective(directives, prerequisiteName);
  if (dependent !== undefined && prerequisite === undefined) {
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
