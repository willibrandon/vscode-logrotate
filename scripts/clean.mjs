import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

await Promise.all(
  [
    "dist",
    "coverage",
    "packages/language-core/lib",
    "packages/language-server/lib",
    "packages/vscode-client/lib",
  ].map((path) => rm(resolve(root, path), { force: true, recursive: true })),
);
