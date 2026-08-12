import { parse } from "./parser.js";
import type {
  CoreDiagnostic,
  DirectiveNode,
  DocumentNode,
  IncludeNode,
  ParsedDocument,
  RotationBlockNode,
} from "./model.js";

export interface ResourceStat {
  readonly type: "file" | "directory" | "other";
  readonly size?: number;
  readonly mtime?: number;
  readonly etag?: string;
}

export interface FileSystemProvider {
  readFile(uri: string): Promise<string>;
  readDirectory(uri: string): Promise<readonly string[]>;
  stat(uri: string): Promise<ResourceStat>;
  resolve(baseUri: string, target: string): string;
  normalize(uri: string): string;
}

export interface IncludeLimits {
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDirectoryEntries: number;
}

export interface EffectiveDirective {
  readonly uri: string;
  readonly directive: DirectiveNode;
}

export type EffectiveSettings = ReadonlyMap<string, EffectiveDirective>;

export interface IncludeFile {
  readonly uri: string;
  readonly document: ParsedDocument;
  readonly depth: number;
  readonly inheritedSettings: EffectiveSettings;
  readonly effectiveSettings: EffectiveSettings;
}

export interface RotationSettingsSnapshot {
  readonly uri: string;
  readonly block: RotationBlockNode;
  readonly settings: EffectiveSettings;
}

export interface IncludeGraph {
  readonly root: string;
  readonly files: ReadonlyMap<string, IncludeFile>;
  readonly rotations: readonly RotationSettingsSnapshot[];
  readonly diagnostics: readonly CoreDiagnostic[];
  readonly totalBytes: number;
  readonly cancelled: boolean;
}

interface TraversalState {
  readonly settings: Map<string, EffectiveDirective>;
  readonly tabooPatterns: readonly string[];
}

interface BuildState {
  readonly bounds: IncludeLimits;
  readonly fileSystem: FileSystemProvider;
  readonly files: Map<string, IncludeFile>;
  readonly documents: Map<string, ParsedDocument>;
  readonly byteLengths: Map<string, number>;
  readonly diagnostics: CoreDiagnostic[];
  readonly rotations: RotationSettingsSnapshot[];
  readonly isCancellationRequested: () => boolean;
  totalBytes: number;
  cancelled: boolean;
}

const defaultTabooExtensions = [
  ",v",
  ".bak",
  ".cfsaved",
  ".disabled",
  ".dpkg-bak",
  ".dpkg-del",
  ".dpkg-dist",
  ".dpkg-new",
  ".dpkg-old",
  ".dpkg-tmp",
  ".new",
  ".old",
  ".orig",
  ".pacnew",
  ".pacorig",
  ".pacsave",
  ".rhn-cfg-tmp-*",
  ".rpmnew",
  ".rpmorig",
  ".rpmsave",
  ".swp",
  ".ucf-dist",
  ".ucf-new",
  ".ucf-old",
  "~",
] as const;

const defaultLimits: IncludeLimits = {
  maxDepth: 16,
  maxFiles: 256,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
  maxDirectoryEntries: 4096,
};

export async function buildIncludeGraph(
  rootUri: string,
  rootSource: string,
  fileSystem: FileSystemProvider,
  limits: Partial<IncludeLimits> = {},
  cancelled: () => boolean = () => false,
): Promise<IncludeGraph> {
  const normalizedRoot = fileSystem.normalize(rootUri);
  const rootBytes = utf8ByteLength(rootSource);
  const rootDocument = parse(rootSource, { cancelled });
  const state: BuildState = {
    bounds: { ...defaultLimits, ...limits },
    fileSystem,
    files: new Map(),
    documents: new Map([[normalizedRoot, rootDocument]]),
    byteLengths: new Map([[normalizedRoot, rootBytes]]),
    diagnostics: [],
    rotations: [],
    isCancellationRequested: cancelled,
    totalBytes: rootBytes,
    cancelled: false,
  };
  if (rootBytes > state.bounds.maxFileBytes || rootBytes > state.bounds.maxTotalBytes) {
    state.diagnostics.push({
      code: "LR3005",
      severity: "information",
      message: `Root resource “${normalizedRoot}” exceeds include-analysis size limits.`,
      source: "logrotate",
      start: 0,
      end: 0,
    });
  } else {
    await processFile(state, normalizedRoot, rootDocument, 0, new Set([normalizedRoot]), {
      settings: new Map(),
      tabooPatterns: defaultTabooExtensions.map((suffix) => `*${suffix}`),
    });
  }
  checkCancellation(state);
  return {
    root: normalizedRoot,
    files: state.files,
    rotations: state.rotations,
    diagnostics: state.diagnostics,
    totalBytes: state.totalBytes,
    cancelled: state.cancelled,
  };
}

async function processFile(
  state: BuildState,
  uri: string,
  document: ParsedDocument,
  depth: number,
  ancestors: ReadonlySet<string>,
  inherited: TraversalState,
): Promise<TraversalState> {
  const inheritedSettings = new Map(inherited.settings);
  let current: TraversalState = {
    settings: new Map(inherited.settings),
    tabooPatterns: inherited.tabooPatterns,
  };
  state.files.set(uri, {
    uri,
    document,
    depth,
    inheritedSettings,
    effectiveSettings: new Map(current.settings),
  });

  for (const node of document.children) {
    if (checkCancellation(state)) break;
    if (node.kind === "directive") {
      current = applyGlobalDirective(current, uri, node);
    } else if (node.kind === "include") {
      current = await processInclude(state, uri, depth, ancestors, current, node);
    } else if (node.kind === "rotation-block") {
      state.rotations.push({
        uri,
        block: node,
        settings: applyBlockDirectives(current.settings, uri, node),
      });
    }
  }

  state.files.set(uri, {
    uri,
    document,
    depth,
    inheritedSettings,
    effectiveSettings: new Map(current.settings),
  });
  return current;
}

async function processInclude(
  state: BuildState,
  containingUri: string,
  depth: number,
  ancestors: ReadonlySet<string>,
  inherited: TraversalState,
  include: IncludeNode,
): Promise<TraversalState> {
  const target = include.target?.value;
  if (target === undefined || checkCancellation(state)) return inherited;
  const targetUri = state.fileSystem.normalize(state.fileSystem.resolve(containingUri, target));
  let targetStat: ResourceStat;
  try {
    targetStat = await state.fileSystem.stat(targetUri);
  } catch {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3001",
        `Cannot read included resource “${bounded(target)}”.`,
        include,
        containingUri,
      ),
    );
    return inherited;
  }
  if (checkCancellation(state)) return inherited;

  if (targetStat.type === "file") {
    return processIncludedFile(
      state,
      targetUri,
      targetStat,
      depth,
      ancestors,
      inherited,
      include,
      containingUri,
    );
  }
  if (targetStat.type !== "directory") {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3006",
        `Included resource “${bounded(target)}” is not a regular file or directory.`,
        include,
        containingUri,
      ),
    );
    return inherited;
  }

  let entries: readonly string[];
  try {
    entries = [...(await state.fileSystem.readDirectory(targetUri))].sort();
  } catch {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3001",
        `Cannot list included directory “${bounded(target)}”.`,
        include,
        containingUri,
      ),
    );
    return inherited;
  }
  if (entries.length > state.bounds.maxDirectoryEntries) {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3007",
        `Include analysis stopped after ${state.bounds.maxDirectoryEntries} directory entries.`,
        include,
        containingUri,
      ),
    );
    entries = entries.slice(0, state.bounds.maxDirectoryEntries);
  }

  let current = inherited;
  for (const entry of entries) {
    if (checkCancellation(state)) break;
    if (entry === "." || entry === ".." || isTabooName(entry, current.tabooPatterns)) continue;
    const entryUri = state.fileSystem.normalize(
      state.fileSystem.resolve(targetUri.endsWith("/") ? targetUri : `${targetUri}/`, entry),
    );
    let entryStat: ResourceStat;
    try {
      entryStat = await state.fileSystem.stat(entryUri);
    } catch {
      state.diagnostics.push(
        includeDiagnostic(
          "LR3001",
          `Cannot read included resource “${bounded(entryUri)}”.`,
          include,
          containingUri,
        ),
      );
      continue;
    }
    if (entryStat.type !== "file") continue;
    current = await processIncludedFile(
      state,
      entryUri,
      entryStat,
      depth,
      ancestors,
      current,
      include,
      containingUri,
    );
  }
  return current;
}

async function processIncludedFile(
  state: BuildState,
  uri: string,
  stat: ResourceStat,
  parentDepth: number,
  ancestors: ReadonlySet<string>,
  inherited: TraversalState,
  include: IncludeNode,
  containingUri: string,
): Promise<TraversalState> {
  if (ancestors.has(uri)) {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3002",
        `Include cycle detected at “${bounded(uri)}”.`,
        include,
        containingUri,
      ),
    );
    return inherited;
  }
  if (parentDepth + 1 > state.bounds.maxDepth) {
    state.diagnostics.push(
      includeDiagnostic(
        "LR3003",
        `Include depth exceeds ${state.bounds.maxDepth}.`,
        include,
        containingUri,
      ),
    );
    return inherited;
  }

  let document = state.documents.get(uri);
  if (document === undefined) {
    if (state.files.size >= state.bounds.maxFiles) {
      state.diagnostics.push(
        includeDiagnostic(
          "LR3004",
          `Include analysis stopped after ${state.bounds.maxFiles} files.`,
          include,
          containingUri,
        ),
      );
      return inherited;
    }
    if (stat.size !== undefined && stat.size > state.bounds.maxFileBytes) {
      state.diagnostics.push(sizeDiagnostic(uri, include, containingUri));
      return inherited;
    }
    let source: string;
    try {
      source = await state.fileSystem.readFile(uri);
    } catch {
      state.diagnostics.push(
        includeDiagnostic(
          "LR3001",
          `Cannot read included resource “${bounded(uri)}”.`,
          include,
          containingUri,
        ),
      );
      return inherited;
    }
    if (checkCancellation(state)) return inherited;
    const bytes = utf8ByteLength(source);
    if (
      bytes > state.bounds.maxFileBytes ||
      state.totalBytes + bytes > state.bounds.maxTotalBytes
    ) {
      state.diagnostics.push(sizeDiagnostic(uri, include, containingUri));
      return inherited;
    }
    state.totalBytes += bytes;
    document = parse(source, { cancelled: state.isCancellationRequested });
    state.documents.set(uri, document);
    state.byteLengths.set(uri, bytes);
  }

  return processFile(
    state,
    uri,
    document,
    parentDepth + 1,
    new Set([...ancestors, uri]),
    inherited,
  );
}

function applyGlobalDirective(
  state: TraversalState,
  uri: string,
  directive: DirectiveNode,
): TraversalState {
  const settings = new Map(state.settings);
  setEffectiveDirective(settings, uri, directive);
  return {
    settings,
    tabooPatterns:
      directive.name === "tabooext" || directive.name === "taboopat"
        ? updateTabooPatterns(state.tabooPatterns, directive)
        : state.tabooPatterns,
  };
}

function applyBlockDirectives(
  inherited: ReadonlyMap<string, EffectiveDirective>,
  uri: string,
  block: RotationBlockNode,
): EffectiveSettings {
  const settings = new Map(inherited);
  for (const node of block.children) {
    const directive = directiveFromNode(node);
    if (directive !== undefined) setEffectiveDirective(settings, uri, directive);
  }
  return settings;
}

function setEffectiveDirective(
  settings: Map<string, EffectiveDirective>,
  uri: string,
  directive: DirectiveNode,
): void {
  if (directive.name === "include" || directive.name === "endscript") return;
  const counterpart = directive.definition?.negatedBy;
  if (counterpart !== undefined && counterpart !== null) settings.delete(counterpart);
  settings.set(directive.name, { uri, directive });
}

function directiveFromNode(node: DocumentNode): DirectiveNode | undefined {
  if (node.kind === "directive") return node;
  if (node.kind === "script") return node.starter;
  return undefined;
}

function updateTabooPatterns(
  current: readonly string[],
  directive: DirectiveNode,
): readonly string[] {
  const raw = directive.arguments
    .map(({ value }) => value)
    .join(" ")
    .trim();
  const append = raw.startsWith("+");
  const value = append ? raw.slice(1).trimStart() : raw;
  const parsed = value
    .split(/[\s,]+/u)
    .filter((pattern) => pattern !== "")
    .map((pattern) => (directive.name === "tabooext" ? `*${pattern}` : pattern));
  return append ? [...current, ...parsed] : parsed;
}

function isTabooName(nameOrUri: string, patterns: readonly string[]): boolean {
  const name = nameOrUri.slice(nameOrUri.lastIndexOf("/") + 1);
  return patterns.some((pattern) => matchesGlob(pattern, name));
}

function matchesGlob(pattern: string, value: string): boolean {
  if (pattern.length > 4096 || value.length > 4096) return false;
  let previous = new Array<boolean>(value.length + 1).fill(false);
  previous[0] = true;
  for (const token of pattern) {
    const current = new Array<boolean>(value.length + 1).fill(false);
    if (token === "*") current[0] = previous[0] ?? false;
    for (let index = 1; index <= value.length; index += 1) {
      current[index] =
        token === "*"
          ? (current[index - 1] ?? false) || (previous[index] ?? false)
          : (previous[index - 1] ?? false) && (token === "?" || token === (value[index - 1] ?? ""));
    }
    previous = current;
  }
  return previous[value.length] ?? false;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function checkCancellation(state: BuildState): boolean {
  if (!state.cancelled && state.isCancellationRequested()) state.cancelled = true;
  return state.cancelled;
}

function sizeDiagnostic(uri: string, include: IncludeNode, resource?: string): CoreDiagnostic {
  return includeDiagnostic(
    "LR3005",
    `Included resource “${bounded(uri)}” exceeds analysis size limits.`,
    include,
    resource,
  );
}

function includeDiagnostic(
  code: string,
  message: string,
  include: IncludeNode,
  resource?: string,
): CoreDiagnostic {
  return {
    code,
    severity: "information",
    message,
    source: "logrotate",
    ...(resource === undefined ? {} : { resource }),
    start: include.target?.start ?? include.start,
    end: include.target?.end ?? include.end,
  };
}

function bounded(value: string): string {
  const maximum = 256;
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}
