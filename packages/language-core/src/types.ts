export type DirectiveScope = "global" | "block";

export type ArgumentKind =
  | "none"
  | "integer"
  | "nonnegative-integer"
  | "positive-integer"
  | "weekday"
  | "monthday"
  | "size"
  | "create"
  | "createolddir"
  | "user-group"
  | "path"
  | "command"
  | "extension"
  | "remainder"
  | "mail-address"
  | "date-format"
  | "taboo-list"
  | "script"
  | "terminator";

export interface ArgumentDefinition {
  readonly kind: ArgumentKind;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minimumArity?: number;
  readonly maximumArity?: number;
}

export interface DirectiveDefinition {
  readonly name: string;
  readonly category: string;
  readonly scopes: readonly DirectiveScope[];
  readonly arguments: Readonly<ArgumentDefinition>;
  readonly negatedBy: string | null;
  readonly interactions: readonly string[];
  readonly since: string;
  readonly deprecated: boolean;
  readonly ignored: boolean;
  readonly documentation: string;
  readonly summary: string;
  readonly completion: string;
  readonly examples: readonly string[];
}

export interface CompletionDefinition {
  readonly label: string;
  readonly insertText: string;
  readonly detail: string;
  readonly deprecated: boolean;
}

export interface HoverDefinition {
  readonly name: string;
  readonly summary: string;
  readonly argumentKind: ArgumentKind;
  readonly scopes: readonly DirectiveScope[];
  readonly since: string;
  readonly deprecated: boolean;
  readonly interactions: readonly string[];
  readonly documentation: string;
}

export interface SemanticDefinition {
  readonly name: string;
  readonly tokenType: "keyword";
  readonly tokenModifiers: readonly "deprecated"[];
}

export interface VersionDefinition {
  readonly version: string;
  readonly upstreamRevision: string;
  readonly dateFormatConversions: readonly string[];
  readonly includeDepth: number;
  readonly notes: string;
}

export type TargetVersionSetting = string;

export interface TargetVersionDetection {
  readonly allowed: boolean;
  readonly version?: string;
}

export interface ResolvedTargetVersion {
  readonly requested: TargetVersionSetting;
  readonly version: string;
  readonly source: "latest" | "detected" | "explicit";
  readonly known: boolean;
  readonly definition?: VersionDefinition;
}
