import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  completionTable,
  directiveByName,
  directiveNames,
  directives,
  hoverTable,
  semanticMetadata,
} from "../src/index.js";

const expectedNames =
  `hourly minutes daily weekly monthly yearly size minsize maxsize minage maxage rotate start compress nocompress delaycompress nodelaycompress compresscmd uncompresscmd compressext compressoptions copy nocopy copytruncate nocopytruncate renamecopy norenamecopy allowhardlink noallowhardlink create nocreate createolddir nocreateolddir olddir noolddir su dateext nodateext dateformat dateyesterday nodateyesterday datehourago nodatehourago extension addextension missingok nomissingok ifempty notifempty ignoreduplicates mail nomail mailfirst maillast shred noshred shredcycles firstaction lastaction prerotate postrotate preremove sharedscripts nosharedscripts endscript include tabooext taboopat errors`
    .split(" ")
    .sort();

interface DirectiveDataDocument {
  readonly upstreamRevision: string;
}

interface VersionDataDocument {
  readonly latest: string;
  readonly supported: readonly {
    readonly upstreamRevision: string;
  }[];
}

describe("directive registry", () => {
  it("contains the 68 reviewed directives plus endscript exactly once", () => {
    expect([...directiveNames].sort()).toEqual(expectedNames);
    expect(directives).toHaveLength(69);
    expect(new Set(directiveNames)).toHaveLength(69);
    expect(directiveNames.filter((name) => name !== "endscript")).toHaveLength(68);
  });

  it("supplies every generated consumer from the same complete records", () => {
    expect(completionTable.map(({ label }) => label).sort()).toEqual(expectedNames);
    expect([...hoverTable.keys()].sort()).toEqual(expectedNames);
    expect(semanticMetadata.map(({ name }) => name).sort()).toEqual(expectedNames);
    for (const directive of directives) {
      expect(directive.category).not.toBe("");
      expect(directive.scopes.length).toBeGreaterThan(0);
      expect(directive.arguments.kind).not.toBe("");
      expect(directive.since).not.toBe("");
      expect(directive.documentation).toMatch(/^https:\/\/github\.com\/logrotate\//u);
      expect(directive.summary).toMatch(/\.$/u);
      expect(directive.completion).not.toBe("");
      expect(directive.examples.length).toBeGreaterThan(0);
      expect(directiveByName.get(directive.name)).toBe(directive);
    }
  });

  it("marks only errors as deprecated and ignored", () => {
    expect(directives.filter(({ deprecated }) => deprecated).map(({ name }) => name)).toEqual([
      "errors",
    ]);
    expect(directiveByName.get("errors")).toMatchObject({ ignored: true });
  });

  it("pins directive and version data to the reviewed upstream revision", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const directiveData = parse(await readFile(resolve(root, "data/directives.yaml"), "utf8"), {
      merge: true,
    }) as unknown as DirectiveDataDocument;
    const versionData = parse(
      await readFile(resolve(root, "data/versions.yaml"), "utf8"),
    ) as unknown as VersionDataDocument;
    const supportedVersion = versionData.supported[0];
    expect(directiveData.upstreamRevision).toBe("3be1e9ccffe0c2245ed596183c74913d553f9f18");
    expect(supportedVersion).toBeDefined();
    expect(supportedVersion?.upstreamRevision).toBe(directiveData.upstreamRevision);
    expect(versionData.latest).toBe("3.22");
  });
});
