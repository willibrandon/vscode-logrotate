export interface ValidationContext {
  readonly isDesktop: boolean;
  readonly isTrusted: boolean;
  readonly scheme: string;
  readonly isSaved: boolean;
  readonly languageId: string;
}

export type ValidationUnavailability =
  "browser" | "untrusted" | "virtual" | "unsaved" | "wrong-language";

export function externalValidationUnavailable(
  context: ValidationContext,
): ValidationUnavailability | undefined {
  if (!context.isDesktop) return "browser";
  if (!context.isTrusted) return "untrusted";
  if (context.scheme !== "file") return "virtual";
  if (!context.isSaved) return "unsaved";
  if (context.languageId !== "logrotate") return "wrong-language";
  return undefined;
}

export function explainUnavailability(reason: ValidationUnavailability): string {
  const explanations: Readonly<Record<ValidationUnavailability, string>> = {
    browser: "Installed logrotate validation is unavailable in a browser extension host.",
    untrusted: "Trust this workspace before running an installed executable.",
    virtual: "Installed logrotate validation requires a local file resource.",
    unsaved: "Save the logrotate configuration before validating it with the installed executable.",
    "wrong-language": "Open a logrotate configuration file before running installed validation.",
  };
  return explanations[reason];
}
