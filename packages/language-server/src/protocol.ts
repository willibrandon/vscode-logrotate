import { RequestType } from "vscode-languageserver-protocol";

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
