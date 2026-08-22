import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const approvalMetadata =
  /<meta\s+name=["']motionprep:legal-status["']\s+content=["']approved["']\s*\/?>/iu;
const reviewedAtMetadata =
  /<meta\s+name=["']motionprep:legal-reviewed-at["']\s+content=["']\d{4}-\d{2}-\d{2}["']\s*\/?>/iu;
const controllerMetadata =
  /<meta\s+name=["']motionprep:data-controller["']\s+content=["'][^"']{3,}["']\s*\/?>/iu;
const draftMarkers = [
  /مسودة/iu,
  /قبل الإطلاق العام/iu,
  /تحتاج اعتماد/iu,
  /يجب اعتمادها قانونيًا/iu,
  /\b(?:draft|placeholder|todo|tbd)\b/iu,
  /\{\{[^}]+\}\}/u,
];

export function validateReleaseLegalDocument(
  source,
  { label, requireControllerAndContact = false },
) {
  const violations = [];
  if (!approvalMetadata.test(source)) {
    violations.push(
      `${label} requires motionprep:legal-status=approved metadata from the legal owner.`,
    );
  }
  if (!reviewedAtMetadata.test(source)) {
    violations.push(
      `${label} requires motionprep:legal-reviewed-at metadata with an ISO date.`,
    );
  }
  for (const marker of draftMarkers) {
    if (marker.test(source)) {
      violations.push(`${label} still contains a draft or placeholder marker.`);
      break;
    }
  }
  if (requireControllerAndContact) {
    if (!controllerMetadata.test(source)) {
      violations.push(`${label} requires an identified data controller.`);
    }
    if (!/<a\s+[^>]*href=["']mailto:[^"']+["']/iu.test(source)) {
      violations.push(`${label} requires a visible privacy contact email link.`);
    }
  }
  return violations;
}

export async function verifyReleaseLegalDocuments(repositoryRoot = root) {
  const [terms, privacy] = await Promise.all([
    readFile(`${repositoryRoot}/apps/web/public/legal/terms.html`, "utf8"),
    readFile(`${repositoryRoot}/apps/web/public/legal/privacy.html`, "utf8"),
  ]);
  return [
    ...validateReleaseLegalDocument(terms, { label: "Terms of use" }),
    ...validateReleaseLegalDocument(privacy, {
      label: "Privacy policy",
      requireControllerAndContact: true,
    }),
  ];
}

async function main() {
  const violations = await verifyReleaseLegalDocuments();
  if (violations.length > 0) {
    throw new Error(`Stable release legal gate failed:\n- ${violations.join("\n- ")}`);
  }
  process.stdout.write("Stable release legal documents are approved and complete.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
