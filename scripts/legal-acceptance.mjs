import { readFile } from "node:fs/promises";

const versions = JSON.parse(
  await readFile(
    new URL(
      "../packages/contracts/src/legal-policy-versions.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

if (
  typeof versions.termsVersion !== "string" ||
  !versions.termsVersion ||
  typeof versions.privacyVersion !== "string" ||
  !versions.privacyVersion
) {
  throw new Error("The legal policy version contract is invalid.");
}

export const currentLegalAcceptance = Object.freeze({
  accepted: true,
  termsVersion: versions.termsVersion,
  privacyVersion: versions.privacyVersion,
});
