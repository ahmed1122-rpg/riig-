import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const buildMapPath = new URL("../docs/BUILD_MAP.md", import.meta.url);
const contractsPath = new URL(
  "../packages/contracts/src/core-contracts.ts",
  import.meta.url,
);
const uploadRoutesPath = new URL(
  "../apps/api/src/uploads/upload-routes.ts",
  import.meta.url,
);
const authBillingAdminPath = new URL(
  "../docs/api/auth-billing-admin.md",
  import.meta.url,
);
const securityPolicyPath = new URL("../SECURITY.md", import.meta.url);
const traceabilityPath = new URL(
  "../docs/VERIFICATION_TRACEABILITY.md",
  import.meta.url,
);
const designTokensPath = new URL("../docs/DESIGN_TOKENS.md", import.meta.url);
const brandedBrowserRunbookPath = new URL(
  "../docs/runbooks/branded-browser-validation.md",
  import.meta.url,
);
const securityRoutePaths = [
  "../apps/api/src/auth/auth-routes.ts",
  "../apps/api/src/privacy/account-privacy-routes.ts",
  "../apps/api/src/billing/billing-routes.ts",
  "../apps/api/src/admin/admin-routes.ts",
].map((path) => new URL(path, import.meta.url));
const [
  buildMap,
  contracts,
  uploadRoutes,
  authBillingAdmin,
  securityPolicy,
  traceability,
  designTokens,
  brandedBrowserRunbook,
  securityRouteSources,
] = await Promise.all([
  readFile(buildMapPath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(uploadRoutesPath, "utf8"),
  readFile(authBillingAdminPath, "utf8"),
  readFile(securityPolicyPath, "utf8"),
  readFile(traceabilityPath, "utf8"),
  readFile(designTokensPath, "utf8"),
  readFile(brandedBrowserRunbookPath, "utf8"),
  Promise.all(securityRoutePaths.map((path) => readFile(path, "utf8"))),
]);
const violations = [];

const capabilityContract = contracts.match(
  /export const exportFormatsByProjectKind = \{([\s\S]*?)\n\} as const satisfies/u,
)?.[1];
const exportFormatsByProjectKind = { image: [], book: [] };
if (!capabilityContract) {
  violations.push(
    "Could not discover exportFormatsByProjectKind from the shared contract.",
  );
} else {
  for (const projectKind of ["image", "book"]) {
    const formats = capabilityContract.match(
      new RegExp(`${projectKind}:\\s*\\[([\\s\\S]*?)\\]`, "u"),
    )?.[1];
    if (!formats) {
      violations.push(`The shared contract is missing ${projectKind} formats.`);
      continue;
    }
    exportFormatsByProjectKind[projectKind] = [
      ...formats.matchAll(/"([^"]+)"/gu),
    ].map((match) => match[1]);
  }
}

const uploadIntentRoute = uploadRoutes.match(
  /app\.post\("(\/v1\/[^"\n]*uploads\/intents)"/,
)?.[1];
if (!uploadIntentRoute) {
  violations.push("Could not discover the upload-intent route from upload-routes.ts.");
} else if (!buildMap.includes(`POST ${uploadIntentRoute}`)) {
  violations.push(
    `docs/BUILD_MAP.md must document the current upload route: POST ${uploadIntentRoute}`,
  );
}

if (buildMap.includes("/v1/projects/:projectId/uploads")) {
  violations.push(
    "docs/BUILD_MAP.md still contains the retired project-scoped upload route.",
  );
}

for (const staleClaim of [
  "المسافات موحدة بتدرج صغير `4/8/12/16px`",
  "الأداة غير المكتملة تظهر «مخطط لها»",
  "التعارض يعيد HTTP 409 ويطلب إعادة التحميل.",
]) {
  if (buildMap.includes(staleClaim)) {
    violations.push(`docs/BUILD_MAP.md contains an overstated claim: ${staleClaim}`);
  }
}
for (const [label, pattern] of [
  ["spacing is not literally uniform", /القيم الحالية ليست موحدة حرفيًا/u],
  ["the registry has no planned state", /سجل الأدوات الحالي لا يملك حالة «مخطط لها»/u],
  ["project creation is conditional", /للمشروع الجديد فقط/u],
  ["revision reload requires confirmation", /يطلب\s+تأكيد تحميل النسخة الأحدث/u],
]) {
  if (!pattern.test(buildMap)) {
    violations.push(`docs/BUILD_MAP.md is missing the evidence boundary: ${label}`);
  }
}

if (!buildMap.includes("Redis طبقة تشغيلية")) {
  violations.push(
    "docs/BUILD_MAP.md must describe Redis as operational infrastructure, not authoritative data storage.",
  );
}
if (buildMap.includes("PostgreSQL وRedis وS3-compatible هي مصادر الحقيقة")) {
  violations.push(
    "docs/BUILD_MAP.md must not describe Redis as a source of truth.",
  );
}

const registeredSecurityRoutes = securityRouteSources.flatMap((source) =>
  [
    ...source.matchAll(
      /\b(?:app|webhookApp)\.(get|post|patch|delete)\(\s*"([^"]+)"/gu,
    ),
  ].map((match) => `${match[1].toUpperCase()} ${match[2]}`),
);
if (registeredSecurityRoutes.length === 0) {
  violations.push("Could not discover auth, account, billing, or admin routes.");
}
for (const route of registeredSecurityRoutes) {
  if (!authBillingAdmin.includes(`\`${route}\``)) {
    violations.push(`docs/api/auth-billing-admin.md must document ${route}.`);
  }
}

for (const staleClaim of [
  "Authentication and payment flows are development/sandbox implementations.",
  "provider adapters and signed webhook verification exist",
  "Live providers and provider-specific signed webhooks must be added",
]) {
  if (securityPolicy.includes(staleClaim) || authBillingAdmin.includes(staleClaim)) {
    violations.push(`Security documentation contains a retired claim: ${staleClaim}`);
  }
}
for (const requiredSecurityControl of [
  "PostgreSQL",
  "TLS-enabled Redis",
  "PAYMENT_MODE=live",
  "raw-body signature verification",
  "digest-qualified images",
]) {
  if (!securityPolicy.includes(requiredSecurityControl)) {
    violations.push(`SECURITY.md must retain the ${requiredSecurityControl} control.`);
  }
}

for (const traceId of [
  "workspace-layout",
  "workspace-tool-availability",
  "revision-conflict",
  "upload-flow",
  "upload-integrity",
  "image-layer-cap",
  "regional-ocr",
  "export-capabilities",
  "adobe-golden",
  "browser-qualification",
  "branded-safari-ios",
  "character-studio",
  "production-authorization",
]) {
  if (!traceability.includes(`\`${traceId}\``)) {
    violations.push(`Verification traceability is missing ${traceId}.`);
  }
}
for (const status of [
  "source-verified",
  "release-qualified",
  "disabled-by-gate",
  "external-pending",
]) {
  if (!traceability.includes(`\`${status}\``)) {
    violations.push(`Verification traceability is missing status ${status}.`);
  }
}
for (const token of [
  "--vp-space-1",
  "--vp-space-2",
  "--vp-space-3",
  "--vp-space-4",
]) {
  if (!designTokens.includes(`\`${token}\``)) {
    violations.push(`Design token documentation is missing ${token}.`);
  }
}
for (const evidenceField of [
  "Release SHA:",
  "Browser brand/version:",
  "Device/model and native pixel density:",
  "Decision: pass | fail",
]) {
  if (!brandedBrowserRunbook.includes(evidenceField)) {
    violations.push(`Branded-browser runbook is missing ${evidenceField}`);
  }
}

const capabilityBlock = buildMap.match(
  /<!-- export-capabilities:start -->([\s\S]*?)<!-- export-capabilities:end -->/,
)?.[1];
if (!capabilityBlock) {
  violations.push("docs/BUILD_MAP.md is missing the export capability table markers.");
} else {
  const documented = { image: [], book: [] };
  for (const line of capabilityBlock.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const format = cells[0]?.match(/^`([^`]+)`/u)?.[1];
    if (!format) continue;
    if (cells[1] !== "—") documented.image.push(format);
    if (cells[2] !== "—") documented.book.push(format);
  }

  for (const projectKind of ["image", "book"]) {
    const expected = [...exportFormatsByProjectKind[projectKind]];
    if (JSON.stringify(documented[projectKind]) !== JSON.stringify(expected)) {
      violations.push(
        `Export formats for ${projectKind} differ: documented=${JSON.stringify(documented[projectKind])}, contract=${JSON.stringify(expected)}.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`Documentation contract violations in ${repositoryRoot}:`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Product and security documentation contracts verified.");
}
