import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const ICON_NAMES = [
  "home", "folder", "help", "settings", "search", "menu", "close",
  "chevron", "plus", "image", "book", "layers", "review", "spark",
  "eye", "eyeOff", "lock", "unlock", "upload", "zoomIn", "zoomOut",
  "pointer", "undo", "check", "warning", "info", "sun", "moon",
  "arrow", "filter", "grid", "list", "download", "refresh", "merge",
  "split", "scan", "panelClose", "panelOpen", "arrowUp", "arrowDown",
  "grip", "packageCheck", "brush", "eraser", "target", "highlighter",
  "boxSelect", "scanText", "badgeCheck", "activity", "creditCard",
  "database", "external", "fileSearch", "gauge", "history", "key",
  "login", "logout", "mail", "server", "shield", "shieldCheck",
  "smartphone", "users", "wallet",
] as const satisfies readonly IconName[];

type MissingIcon = Exclude<IconName, (typeof ICON_NAMES)[number]>;
const ALL_ICONS_COVERED: [MissingIcon] extends [never] ? true : never = true;

describe("Icon", () => {
  it("renders the shared SVG contract without per-icon component wrappers", () => {
    const markup = renderToStaticMarkup(
      <Icon name="layers" size={18} className="test-icon" />,
    );

    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('class="app-icon test-icon"');
    expect(markup).toContain('width="18"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("lucide-");
  });

  it("keeps opposing actions visually distinct", () => {
    const pairs = [
      ["panelOpen", "panelClose"],
      ["arrowUp", "arrowDown"],
      ["login", "logout"],
      ["eye", "eyeOff"],
    ] as const;

    for (const [first, second] of pairs) {
      expect(renderToStaticMarkup(<Icon name={first} />)).not.toBe(
        renderToStaticMarkup(<Icon name={second} />),
      );
    }
  });

  it("preserves filled details in Lucide path data", () => {
    expect(renderToStaticMarkup(<Icon name="key" />)).toContain(
      'fill="currentColor"',
    );
  });

  it("locks the complete icon catalog to its reviewed vector data", () => {
    const catalog = ICON_NAMES.map((name) =>
      renderToStaticMarkup(<Icon name={name} />),
    );

    expect(ICON_NAMES).toHaveLength(67);
    expect(ALL_ICONS_COVERED).toBe(true);
    expect(new Set(catalog)).toHaveLength(ICON_NAMES.length);
    expect(catalog.every((markup) => !markup.includes("undefined"))).toBe(true);
    expect(createHash("sha256").update(catalog.join("\n")).digest("hex")).toBe(
      "b2b753412158f0a1143f439ec35cc41e67bdf8ff7b386d2dadf377b2ff7f61b2",
    );
  });
});
