import { createHash } from "node:crypto";

export function prepareCycloneDxForAttestation(value, seed) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    value.bomFormat !== "CycloneDX" ||
    typeof value.specVersion !== "string"
  ) {
    throw new Error("The generated SBOM is not a CycloneDX JSON document.");
  }

  const digest = createHash("sha256").update(seed).digest("hex");
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");

  return { ...value, serialNumber: `urn:uuid:${uuid}` };
}
