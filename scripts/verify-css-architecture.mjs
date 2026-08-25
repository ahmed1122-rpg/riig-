import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const styles = join(root, "apps/web/src/styles");
const main = await readFile(join(styles, "main.css"), "utf8");
const entry = await readFile(join(root, "apps/web/src/main.tsx"), "utf8");
const accessibility = await readFile(
  join(styles, "overrides/accessibility-responsive.css"),
  "utf8",
);
const shell = await readFile(join(styles, "index.css"), "utf8");
const workspaceFoundation = await readFile(
  join(styles, "features/workspace-foundation.css"),
  "utf8",
);
const visualSystem = await readFile(join(styles, "visual-polish.css"), "utf8");
const violations = [];
const atelierFragments = [
  "foundation.css",
  "application-shell.css",
  "marketing.css",
  "auth.css",
  "help.css",
  "admin.css",
  "workspace.css",
  "responsive-refinements.css",
  "restrained-overrides.css",
];
const workspaceFragments = [
  "shell-tools.css",
  "dialogs.css",
  "preview.css",
  "layers.css",
  "status-focus.css",
  "mobile-panels.css",
  "responsive.css",
];
const exportReviewFragments = [
  "shell-preview.css",
  "layer-review.css",
  "setup-actions.css",
  "responsive.css",
];
const accountAdminFragments = [
  "primitives.css",
  "auth.css",
  "billing-security.css",
  "admin.css",
  "responsive.css",
];
const guidedEditorFragments = [
  "guidance.css",
  "pdf-editing.css",
  "responsive.css",
];
const marketingPolishFragments = [
  "navigation-hero.css",
  "pipeline.css",
  "capabilities.css",
  "workflows.css",
];
const fragmentGroups = [
  ["Atelier", "atelier", atelierFragments],
  ["workspace", "workspace", workspaceFragments],
  ["export review", "export-review", exportReviewFragments],
  ["account/admin", "account-admin", accountAdminFragments],
  ["guided editor", "guided-editors", guidedEditorFragments],
  ["marketing polish", "marketing-polish", marketingPolishFragments],
];

for (const token of [
  "@layer tokens, base, primitives, shells, features, overrides;",
  "layer(tokens)",
  "layer(shells)",
  "layer(features)",
  "layer(overrides)",
]) {
  if (!main.includes(token)) violations.push(`main.css is missing ${token}`);
}
for (const [token, value] of [
  ["--vp-space-1", "4px"],
  ["--vp-space-2", "8px"],
  ["--vp-space-3", "12px"],
  ["--vp-space-4", "16px"],
  ["--vp-space-5", "20px"],
  ["--vp-space-6", "24px"],
  ["--vp-space-8", "32px"],
]) {
  if (!visualSystem.includes(`${token}: ${value};`)) {
    violations.push(`Visual spacing contract is missing ${token}: ${value}.`);
  }
}
if (!workspaceFoundation.includes("gap: var(--vp-space-1)")) {
  violations.push(
    "Workspace foundation must consume the compact spacing token before broader migration.",
  );
}
for (const [label, directory, fragments] of fragmentGroups) {
  const positions = fragments.map((fragment) =>
    main.indexOf(`./${directory}/${fragment}`),
  );
  if (positions.some((position) => position < 0)) {
    violations.push(`main.css must import every ${label} fragment.`);
  }
  if (
    positions.some(
      (position, index) => index > 0 && position <= positions[index - 1],
    )
  ) {
    violations.push(
      `${label} fragments must preserve their documented cascade order.`,
    );
  }
}
if (
  main.lastIndexOf("./overrides/accessibility-responsive.css") <
  main.lastIndexOf("./atelier/restrained-overrides.css")
) {
  violations.push(
    "The accessibility contract must be the final override import.",
  );
}
if (!entry.includes('import "./styles/main.css";')) {
  violations.push("The web entrypoint must import the single layered stylesheet.");
}
if ((entry.match(/\.css"/gu) ?? []).length !== 1) {
  violations.push("The web entrypoint must not depend on implicit CSS import order.");
}
for (const filename of await readdir(styles, { recursive: true })) {
  if (/legacy|evaluation/iu.test(filename)) {
    violations.push(`Legacy/evaluation stylesheet remains: ${filename}`);
  }
}
for (const token of [
  "font-size: max(14px, 0.875rem)",
  "font-size: 12px",
  "min-block-size: 44px",
  ".app-shell .mobile-menu",
  ".app-shell .sidebar-close",
]) {
  if (!accessibility.includes(token)) {
    violations.push(`Accessibility contract is missing ${token}`);
  }
}
for (const relative of [
  "features/workspace-foundation.css",
  "overrides/accessibility-responsive.css",
  ...fragmentGroups.flatMap(([, directory, fragments]) =>
    fragments.map((fragment) => `${directory}/${fragment}`),
  ),
]) {
  try {
    await access(join(styles, relative));
  } catch {
    violations.push(`Missing layered stylesheet: ${relative}`);
  }
}
for (const [name, source] of [
  ["shell", shell],
  ["workspace foundation", workspaceFoundation],
]) {
  if (
    /\.(?:mobile-menu|sidebar-close)\s*\{[^}]*display:\s*(?:none|inline-grid)\s*!important/iu.test(
      source,
    )
  ) {
    violations.push(
      `${name} must not use !important for responsive menu visibility because important declarations reverse cascade-layer precedence.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Layered CSS architecture and accessibility contract verified.\n",
  );
}
