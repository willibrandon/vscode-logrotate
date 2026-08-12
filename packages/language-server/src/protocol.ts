import { NotificationType, RequestType } from "vscode-languageserver-protocol";

export interface ReadFileParams {
  readonly uri: string;
}

export interface ReadDirectoryParams {
  readonly uri: string;
}

export interface ResourceStatResult {
  readonly type: "file" | "directory" | "other";
  readonly size: number;
  readonly mtime: number;
  readonly etag?: string;
}

export interface LoadedIncludesParams {
  readonly rootUri: string;
  readonly resources: readonly LoadedIncludeResource[];
}

export interface LoadedIncludeResource {
  readonly uri: string;
  readonly type: "file" | "directory";
}

export interface IncludedResourceChangedParams {
  readonly uri: string;
}

export const readFileRequest: RequestType<ReadFileParams, string, void> = new RequestType<
  ReadFileParams,
  string,
  void
>("logrotate/fs/readFile");
export const readDirectoryRequest: RequestType<ReadDirectoryParams, readonly string[], void> =
  new RequestType<ReadDirectoryParams, readonly string[], void>("logrotate/fs/readDirectory");
export const statRequest: RequestType<ReadFileParams, ResourceStatResult, void> = new RequestType<
  ReadFileParams,
  ResourceStatResult,
  void
>("logrotate/fs/stat");
export const loadedIncludesNotification: NotificationType<LoadedIncludesParams> =
  new NotificationType<LoadedIncludesParams>("logrotate/includes/loaded");
export const includedResourceChangedNotification: NotificationType<IncludedResourceChangedParams> =
  new NotificationType<IncludedResourceChangedParams>("logrotate/includes/changed");
