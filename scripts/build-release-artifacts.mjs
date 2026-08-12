import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createVSIX } from "@vscode/vsce";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const vsix = resolve(root, `dist/logrotate-${manifest.version}.vsix`);
const sbom = resolve(root, `dist/logrotate-${manifest.version}.cdx.json`);
const checksum = resolve(root, `dist/logrotate-${manifest.version}.sha256`);

await Promise.all([
  rm(vsix, { force: true }),
  rm(sbom, { force: true }),
  rm(checksum, { force: true }),
]);
await createVSIX({ cwd: root, packagePath: vsix, dependencies: false });
await execute(
  process.execPath,
  [
    resolve(root, "node_modules/@cyclonedx/cyclonedx-npm/bin/cyclonedx-npm-cli.js"),
    "--package-lock-only",
    "--omit",
    "dev",
    "--output-reproducible",
    "--validate",
    "--output-format",
    "JSON",
    "--output-file",
    sbom,
    resolve(root, "package.json"),
  ],
  { cwd: root },
);
const digest = createHash("sha256")
  .update(await readFile(vsix))
  .digest("hex");
await writeFile(checksum, `${digest}  ${basename(vsix)}\n`, "utf8");

const sbomText = await readFile(sbom, "utf8");
if (/(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\\\Users\\\\[^\\\s]+)/u.test(sbomText)) {
  throw new Error("The generated SBOM contains a private build path.");
}
console.log(`Created ${basename(vsix)}, ${basename(checksum)}, and ${basename(sbom)}.`);
