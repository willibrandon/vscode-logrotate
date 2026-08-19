import { describe, expect, it } from "vitest";

interface ExpectedRelease {
  readonly name: string;
  readonly preRelease: boolean;
  readonly publisher: string;
  readonly sha256: string;
  readonly version: string;
}

interface OpenVsxReleaseModule {
  isExpectedOpenVsxRelease(metadata: unknown, expected: ExpectedRelease): boolean;
  waitForOpenVsxRelease(options: {
    readonly attempts: number;
    readonly delay: () => Promise<void>;
    readonly expected: ExpectedRelease;
    readonly query: () => Promise<unknown>;
    readonly readSha256: (metadata: unknown) => Promise<string>;
  }): Promise<unknown>;
}

const moduleUrl = new URL("../verify-open-vsx-release.mjs", import.meta.url);
const release = (await import(moduleUrl.href)) as OpenVsxReleaseModule;
const expected = {
  publisher: "willibrandon",
  name: "logrotate",
  version: "0.2.0",
  preRelease: false,
  sha256: "a".repeat(64),
} as const;

describe("Open VSX release verification", () => {
  it("requires the exact publisher, extension, version, channel, and universal package", () => {
    expect(release.isExpectedOpenVsxRelease(openVsxMetadata(), expected)).toBe(true);
    expect(
      release.isExpectedOpenVsxRelease(openVsxMetadata({ namespace: "somebody-else" }), expected),
    ).toBe(false);
    expect(release.isExpectedOpenVsxRelease(openVsxMetadata({ name: "other" }), expected)).toBe(
      false,
    );
    expect(release.isExpectedOpenVsxRelease(openVsxMetadata({ version: "0.2.1" }), expected)).toBe(
      false,
    );
    expect(release.isExpectedOpenVsxRelease(openVsxMetadata({ preRelease: true }), expected)).toBe(
      false,
    );
    expect(
      release.isExpectedOpenVsxRelease(openVsxMetadata({ targetPlatform: "linux-x64" }), expected),
    ).toBe(false);
    expect(
      release.isExpectedOpenVsxRelease(openVsxMetadata({ downloadable: false }), expected),
    ).toBe(false);
    expect(
      release.isExpectedOpenVsxRelease(
        openVsxMetadata({ files: { sha256: "https://example.com/package.sha256" } }),
        expected,
      ),
    ).toBe(false);
    expect(release.isExpectedOpenVsxRelease(undefined, expected)).toBe(false);
  });

  it("retries stale metadata and checksum responses before accepting the release", async () => {
    const responses: unknown[] = [
      new Error("temporary Open VSX failure"),
      openVsxMetadata({ version: "0.1.9" }),
      openVsxMetadata(),
      openVsxMetadata(),
    ];
    const checksums = ["b".repeat(64), expected.sha256];
    let queries = 0;
    let checksumReads = 0;
    let delays = 0;

    const result = await release.waitForOpenVsxRelease({
      attempts: 5,
      delay: () => {
        delays += 1;
        return Promise.resolve();
      },
      expected,
      query: () => {
        const response = responses[queries];
        queries += 1;
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      },
      readSha256: () => {
        const checksum = checksums[checksumReads];
        checksumReads += 1;
        return Promise.resolve(checksum ?? "");
      },
    });

    expect(result).toEqual(responses[3]);
    expect(queries).toBe(4);
    expect(checksumReads).toBe(2);
    expect(delays).toBe(3);
  });

  it("stops at the retry bound and retains the final Open VSX failure", async () => {
    let queries = 0;
    let delays = 0;

    let failure: unknown;
    try {
      await release.waitForOpenVsxRelease({
        attempts: 3,
        delay: () => {
          delays += 1;
          return Promise.resolve();
        },
        expected,
        query: () => {
          queries += 1;
          return Promise.reject(new Error(`failure ${queries}`));
        },
        readSha256: () => Promise.resolve(expected.sha256),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("Expected Open VSX verification to fail.");
    expect(failure.message).toBe("Open VSX release verification failed after 3 attempts.");
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe("failure 3");
    expect(queries).toBe(3);
    expect(delays).toBe(2);
  });
});

function openVsxMetadata(overrides: Record<string, unknown> = {}): unknown {
  return {
    namespace: expected.publisher,
    name: expected.name,
    version: expected.version,
    preRelease: expected.preRelease,
    targetPlatform: "universal",
    downloadable: true,
    files: {
      sha256: `https://open-vsx.org/api/${expected.publisher}/${expected.name}/${expected.version}/file/package.sha256`,
    },
    ...overrides,
  };
}
