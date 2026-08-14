import type { LayerDocument, LayerNode } from "@motionprep/contracts";

const INVALID_NAME_CHARACTERS = /[\u0000-\u001F\u007F\\/]/u;

export function normalizeLayerName(rawName: string): `+${string}` {
  const normalized = rawName
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/gu, "")
    .replace(/[\\/]/gu, "-")
    .trim()
    .slice(0, 120);
  const withoutPrefix = normalized.replace(/^\++/u, "");
  return `+${withoutPrefix || "layer"}`;
}

export function isValidLayerName(name: string): name is `+${string}` {
  return (
    name.length >= 2 &&
    name.length <= 121 &&
    name.startsWith("+") &&
    !name.startsWith("++") &&
    !INVALID_NAME_CHARACTERS.test(name) &&
    normalizeLayerName(name) === name
  );
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

export function createPdfBackgroundLayerName(pageNumber: number): `+${string}` {
  return `${createPdfPageGroupName(pageNumber)}_background`;
}

export function createPdfPageGroupName(pageNumber: number): `+${string}` {
  const safePage = Math.max(1, Math.trunc(pageNumber));
  return `+page_${safePage.toString().padStart(3, "0")}`;
}

export function isPdfPageRootGroup(
  layer: Pick<LayerNode, "kind" | "name" | "pageNumber" | "parentId">,
): boolean {
  return (
    layer.kind === "group" &&
    layer.parentId === null &&
    layer.pageNumber !== undefined &&
    layer.name === createPdfPageGroupName(layer.pageNumber)
  );
}

export function createPdfTextLayerName(
  fullText: string,
  kind: "heading" | "topic" | "sentence" | "line" | "word" | "character",
): `+${string}` {
  const readable = fullText
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/gu, "")
    .replace(/[\\/:+*?"<>|]/gu, " ")
    .trim()
    .replace(/\s+/gu, "_");
  const semantic = kind === "character" ? `حرف_${readable}` : readable;
  return semantic.length <= 60
    ? normalizeLayerName(semantic)
    : normalizeLayerName(`${semantic.slice(0, 53)}_${stableHash(fullText)}`);
}

export function layerNameScopeKey(
  layer: Pick<LayerNode, "parentId" | "pageNumber">,
): string {
  return `${layer.pageNumber ?? "document"}:${layer.parentId ?? "root"}`;
}

export function canonicalLayerName(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("und");
}

export function createUniqueLayerName(
  requested: string,
  usedNames: ReadonlySet<string>,
): `+${string}` {
  const normalized = normalizeLayerName(requested);
  if (!usedNames.has(canonicalLayerName(normalized))) return normalized;
  const stem = normalized.slice(1, 112);
  for (let suffix = 2; suffix <= 9_999; suffix += 1) {
    const candidate = normalizeLayerName(`${stem}_${suffix}`);
    if (!usedNames.has(canonicalLayerName(candidate))) return candidate;
  }
  return normalizeLayerName(`${stem}_${stableHash(requested)}`);
}

export function normalizeDocumentLayerNames(
  document: LayerDocument,
  selectedIds?: ReadonlySet<string>,
): { document: LayerDocument; affectedLayerIds: string[] } {
  const usedByScope = new Map<string, Set<string>>();
  for (const layer of document.layers) {
    if (
      !layer.fixed &&
      !layer.locked &&
      (selectedIds === undefined || selectedIds.has(layer.id))
    ) continue;
    const scope = layerNameScopeKey(layer);
    const used = usedByScope.get(scope) ?? new Set<string>();
    used.add(canonicalLayerName(layer.name));
    usedByScope.set(scope, used);
  }
  const affectedLayerIds: string[] = [];
  const layers = document.layers.map((layer) => {
    const scope = layerNameScopeKey(layer);
    const used = usedByScope.get(scope) ?? new Set<string>();
    const editable =
      !layer.fixed &&
      !layer.locked &&
      (selectedIds === undefined || selectedIds.has(layer.id));
    const nextName = editable
      ? createUniqueLayerName(layer.name, used)
      : layer.name;
    if (editable) used.add(canonicalLayerName(nextName));
    usedByScope.set(scope, used);
    if (nextName === layer.name) return layer;
    affectedLayerIds.push(layer.id);
    return { ...layer, name: nextName };
  });
  return { document: { ...document, layers }, affectedLayerIds };
}
