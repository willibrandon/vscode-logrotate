import { describe, expect, it } from "vitest";

interface ExpectedRelease {
  readonly name: string;
  readonly preRelease: boolean;
  readonly publisher: string;
  readonly sha256: string;
  readonly version: string;
}

interface MarketplaceReleaseModule {
  isMarketplacePropagationError(error: unknown): boolean;
  isExpectedMarketplaceRelease(metadata: unknown, expected: ExpectedRelease): boolean;
  waitForMarketplaceInstallation(options: {
    readonly attempts: number;
    readonly delay: () => Promise<void>;
    readonly install: () => Promise<void>;
  }): Promise<void>;
  waitForMarketplaceRelease(options: {
    readonly attempts: number;
    readonly delay: () => Promise<void>;
    readonly expected: ExpectedRelease;
    readonly query: () => Promise<unknown>;
  }): Promise<unknown>;
}

const moduleUrl = new URL("../verify-marketplace-release.mjs", import.meta.url);
const release = (await import(moduleUrl.href)) as MarketplaceReleaseModule;
const expected = {
  publisher: "willibrandon",
  name: "logrotate",
  version: "0.1.0",
  preRelease: true,
  sha256: "a".repeat(64),
} as const;

describe("Marketplace release verification", () => {
  it("requires the exact publisher, extension, version, channel, and VSIX checksum", () => {
    const metadata = marketplaceMetadata(
      "willibrandon",
      "logrotate",
      "0.1.0",
      true,
      expected.sha256,
    );

    expect(release.isExpectedMarketplaceRelease(metadata, expected)).toBe(true);
    expect(
      release.isExpectedMarketplaceRelease(
        marketplaceMetadata("somebody-else", "logrotate", "0.1.0", true, expected.sha256),
        expected,
      ),
    ).toBe(false);
    expect(
      release.isExpectedMarketplaceRelease(
        marketplaceMetadata("willibrandon", "other", "0.1.0", true, expected.sha256),
        expected,
      ),
    ).toBe(false);
    expect(
      release.isExpectedMarketplaceRelease(
        marketplaceMetadata("willibrandon", "logrotate", "0.1.1", true, expected.sha256),
        expected,
      ),
    ).toBe(false);
    expect(
      release.isExpectedMarketplaceRelease(
        marketplaceMetadata("willibrandon", "logrotate", "0.1.0", false, expected.sha256),
        expected,
      ),
    ).toBe(false);
    expect(
      release.isExpectedMarketplaceRelease(
        marketplaceMetadata("willibrandon", "logrotate", "0.1.0", true, "b".repeat(64)),
        expected,
      ),
    ).toBe(false);
    expect(release.isExpectedMarketplaceRelease(undefined, expected)).toBe(false);
  });

  it("retries transient and stale responses before accepting the exact release", async () => {
    const responses: unknown[] = [
      new Error("temporary Marketplace failure"),
      marketplaceMetadata("willibrandon", "logrotate", "0.0.9", false, expected.sha256),
      marketplaceMetadata("willibrandon", "logrotate", "0.1.0", true, expected.sha256),
    ];
    let queries = 0;
    let delays = 0;

    const result = await release.waitForMarketplaceRelease({
      attempts: 4,
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
    });

    expect(result).toEqual(responses[2]);
    expect(queries).toBe(3);
    expect(delays).toBe(2);
  });

  it("stops at the retry bound and retains the final Marketplace failure", async () => {
    let queries = 0;
    let delays = 0;

    let failure: unknown;
    try {
      await release.waitForMarketplaceRelease({
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
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("Expected Marketplace verification to fail.");
    expect(failure.message).toBe("Marketplace release verification failed after 3 attempts.");
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe("failure 3");
    expect(queries).toBe(3);
    expect(delays).toBe(2);
  });

  it("retries installation while the published version propagates to the VS Code install feed", async () => {
    let attempts = 0;
    let delays = 0;

    await release.waitForMarketplaceInstallation({
      attempts: 4,
      delay: () => {
        delays += 1;
        return Promise.resolve();
      },
      install: () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(
            marketplaceInstallError("Extension 'willibrandon.logrotate@0.1.0' not found."),
          );
        }
        return Promise.resolve();
      },
    });

    expect(attempts).toBe(3);
    expect(delays).toBe(2);
  });

  it("does not retry installation or activation failures unrelated to propagation", async () => {
    let attempts = 0;
    let delays = 0;
    const activationFailure = new Error("Installed-extension smoke test exited with code 1.");

    await expect(
      release.waitForMarketplaceInstallation({
        attempts: 4,
        delay: () => {
          delays += 1;
          return Promise.resolve();
        },
        install: () => {
          attempts += 1;
          return Promise.reject(activationFailure);
        },
      }),
    ).rejects.toBe(activationFailure);

    expect(attempts).toBe(1);
    expect(delays).toBe(0);
  });

  it("stops installation retries at the configured bound", async () => {
    let attempts = 0;
    const propagationFailure = marketplaceInstallError(
      "Extension 'willibrandon.logrotate@0.1.0' not found.",
    );

    await expect(
      release.waitForMarketplaceInstallation({
        attempts: 2,
        delay: () => Promise.resolve(),
        install: () => {
          attempts += 1;
          return Promise.reject(propagationFailure);
        },
      }),
    ).rejects.toMatchObject({
      message: "Marketplace installation verification failed after 2 attempts.",
      cause: propagationFailure,
    });
    expect(attempts).toBe(2);
  });
});

function marketplaceInstallError(stderr: string): Error & { readonly stderr: string } {
  return Object.assign(new Error("VS Code extension installation failed."), { stderr });
}

function marketplaceMetadata(
  publisher: string,
  name: string,
  version: string,
  preRelease: boolean,
  sha256: string,
): unknown {
  return {
    publisher: { publisherName: publisher },
    extensionName: name,
    versions: [
      {
        version,
        properties: [
          ...(preRelease ? [{ key: "Microsoft.VisualStudio.Code.PreRelease", value: "true" }] : []),
          { key: "Microsoft.VisualStudio.Services.VsixSha256", value: sha256 },
        ],
      },
    ],
  };
}
