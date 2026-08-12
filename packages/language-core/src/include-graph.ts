import { parse } from "./parser.js";
import type { CoreDiagnostic, DocumentNode, IncludeNode, ParsedDocument } from "./model.js";

export interface ResourceStat {
  readonly type: "file" | "directory" | "other";
  readonly size?: number;
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
}

export interface IncludeFile {
  readonly uri: string;
  readonly document: ParsedDocument;
  readonly depth: number;
}

export interface IncludeGraph {
  readonly root: string;
  readonly files: ReadonlyMap<string, IncludeFile>;
  readonly diagnostics: readonly CoreDiagnostic[];
  readonly cancelled: boolean;
}

const defaultLimits: IncludeLimits = {
  maxDepth: 16,
  maxFiles: 256,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
};

export async function buildIncludeGraph(
  rootUri: string,
  rootSource: string,
  fileSystem: FileSystemProvider,
  limits: Partial<IncludeLimits> = {},
  cancelled: () => boolean = () => false,
): Promise<IncludeGraph> {
  const bounds = { ...defaultLimits, ...limits };
  const files = new Map<string, IncludeFile>();
  const diagnostics: CoreDiagnostic[] = [];
  let totalBytes = rootSource.length;
  const normalizedRoot = fileSystem.normalize(rootUri);
  const root = { uri: normalizedRoot, document: parse(rootSource), depth: 0 };
  files.set(normalizedRoot, root);

  const visit = async (file: IncludeFile, ancestors: ReadonlySet<string>): Promise<void> => {
    if (cancelled()) {
      return;
    }
    for (const include of collectIncludes(file.document.children)) {
      if (cancelled()) {
        return;
      }
      const target = include.target?.value;
      if (target === undefined) {
        continue;
      }
      const targetUri = fileSystem.normalize(fileSystem.resolve(file.uri, target));
      let stat: ResourceStat;
      try {
        stat = await fileSystem.stat(targetUri);
      } catch {
        diagnostics.push(
          includeDiagnostic("LR3001", `Cannot read included resource “${target}”.`, include),
        );
        continue;
      }
      const entries =
        stat.type === "directory"
          ? [...(await fileSystem.readDirectory(targetUri))].sort()
          : [targetUri];
      for (const entry of entries) {
        if (cancelled()) {
          return;
        }
        const uri = fileSystem.normalize(
          stat.type === "directory"
            ? fileSystem.resolve(targetUri.endsWith("/") ? targetUri : `${targetUri}/`, entry)
            : entry,
        );
        if (ancestors.has(uri)) {
          diagnostics.push(
            includeDiagnostic("LR3002", `Include cycle detected at “${uri}”.`, include),
          );
          continue;
        }
        if (file.depth + 1 > bounds.maxDepth) {
          diagnostics.push(
            includeDiagnostic("LR3003", `Include depth exceeds ${bounds.maxDepth}.`, include),
          );
          continue;
        }
        if (files.size >= bounds.maxFiles) {
          diagnostics.push(
            includeDiagnostic(
              "LR3004",
              `Include analysis stopped after ${bounds.maxFiles} files.`,
              include,
            ),
          );
          return;
        }
        let entryStat: ResourceStat;
        try {
          entryStat = await fileSystem.stat(uri);
        } catch {
          diagnostics.push(
            includeDiagnostic("LR3001", `Cannot read included resource “${uri}”.`, include),
          );
          continue;
        }
        if (entryStat.type !== "file" || isTabooName(uri)) {
          continue;
        }
        const source = await fileSystem.readFile(uri);
        if (
          source.length > bounds.maxFileBytes ||
          totalBytes + source.length > bounds.maxTotalBytes
        ) {
          diagnostics.push(
            includeDiagnostic(
              "LR3005",
              `Included resource “${uri}” exceeds analysis size limits.`,
              include,
            ),
          );
          continue;
        }
        totalBytes += source.length;
        const child = { uri, document: parse(source), depth: file.depth + 1 };
        files.set(uri, child);
        await visit(child, new Set([...ancestors, uri]));
      }
    }
  };

  await visit(root, new Set([normalizedRoot]));
  return { root: normalizedRoot, files, diagnostics, cancelled: cancelled() };
}

function collectIncludes(nodes: readonly DocumentNode[]): IncludeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "include") {
      return [node];
    }
    if (node.kind === "rotation-block") {
      return collectIncludes(node.children);
    }
    return [];
  });
}

function isTabooName(uri: string): boolean {
  return /(?:,v|\.bak|\.disabled|\.dpkg-(?:bak|del|dist|new|old|tmp)|\.new|\.old|\.orig|\.pac(?:new|orig|save)|\.rpm(?:new|orig|save)|\.swp|\.ucf-(?:dist|new|old)|~)$/u.test(
    uri,
  );
}

function includeDiagnostic(code: string, message: string, include: IncludeNode): CoreDiagnostic {
  return {
    code,
    severity: "information",
    message,
    source: "logrotate",
    start: include.target?.start ?? include.start,
    end: include.target?.end ?? include.end,
  };
}
