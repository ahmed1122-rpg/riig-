import policyVersions from "./legal-policy-versions.json" with { type: "json" };

export const CURRENT_TERMS_VERSION = policyVersions.termsVersion;
export const CURRENT_PRIVACY_VERSION = policyVersions.privacyVersion;

export interface LegalAcceptance {
  termsVersion: typeof CURRENT_TERMS_VERSION;
  privacyVersion: typeof CURRENT_PRIVACY_VERSION;
  accepted: true;
}
