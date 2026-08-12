import type { DirectiveDefinition, DirectiveScope } from "./types.js";

export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface LineInfo extends TextSpan {
  readonly line: number;
  readonly contentEnd: number;
  readonly newline: "" | "\n" | "\r\n" | "\r";
}

export type TokenKind =
  | "whitespace"
  | "newline"
  | "comment"
  | "word"
  | "quoted"
  | "escape"
  | "open-brace"
  | "close-brace"
  | "equals"
  | "raw-shell"
  | "unknown";

export interface Token extends TextSpan {
  readonly kind: TokenKind;
  readonly raw: string;
}

export interface DecodedArgument extends TextSpan {
  readonly raw: string;
  readonly value: string;
  readonly quoted: boolean;
  readonly complete: boolean;
}

export interface BaseNode extends TextSpan {
  readonly raw: string;
}

export interface BlankNode extends BaseNode {
  readonly kind: "blank";
}

export interface CommentNode extends BaseNode {
  readonly kind: "comment";
  readonly text: string;
}

export interface DirectiveNode extends BaseNode {
  readonly kind: "directive";
  readonly name: string;
  readonly nameSpan: TextSpan;
  readonly scope: DirectiveScope;
  readonly definition?: DirectiveDefinition;
  readonly arguments: readonly DecodedArgument[];
}

export interface IncludeNode extends BaseNode {
  readonly kind: "include";
  readonly directive: DirectiveNode;
  readonly target?: DecodedArgument;
}

export interface PathHeaderNode extends BaseNode {
  readonly kind: "path-header";
  readonly paths: readonly DecodedArgument[];
  readonly openBrace?: TextSpan;
}

export interface ScriptNode extends BaseNode {
  readonly kind: "script";
  readonly starter: DirectiveNode;
  readonly body: string;
  readonly bodySpan: TextSpan;
  readonly terminator?: DirectiveNode;
}

export interface RotationBlockNode extends BaseNode {
  readonly kind: "rotation-block";
  readonly header: PathHeaderNode;
  readonly children: readonly DocumentNode[];
  readonly closeBrace?: TextSpan;
}

export interface ErrorNode extends BaseNode {
  readonly kind: "error";
  readonly message: string;
}

export type DocumentNode =
  | BlankNode
  | CommentNode
  | DirectiveNode
  | IncludeNode
  | PathHeaderNode
  | ScriptNode
  | RotationBlockNode
  | ErrorNode;

export interface ParsedDocument extends TextSpan {
  readonly kind: "document";
  readonly source: string;
  readonly tokens: readonly Token[];
  readonly children: readonly DocumentNode[];
  readonly diagnostics: readonly CoreDiagnostic[];
  readonly newline: "\n" | "\r\n" | "\r";
}

export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";
export type DiagnosticTag = "deprecated" | "unnecessary";

export interface CoreDiagnostic extends TextSpan {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: "logrotate" | "logrotate-state";
  readonly tags?: readonly DiagnosticTag[];
  readonly related?: readonly TextSpan[];
}

export interface ValidationOptions {
  readonly maxProblems?: number;
  readonly targetVersion?: string;
  readonly cancelled?: () => boolean;
}

export interface StateRecord extends TextSpan {
  readonly path: string;
  readonly pathSpan: TextSpan;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
  readonly second?: number;
}

export interface ParsedStateDocument extends TextSpan {
  readonly kind: "state-document";
  readonly source: string;
  readonly version?: 1 | 2;
  readonly records: readonly StateRecord[];
  readonly diagnostics: readonly CoreDiagnostic[];
}

export interface TextEdit extends TextSpan {
  readonly newText: string;
}
