import { createHash } from "node:crypto";
import type {
  CharacterRigExportManifest,
  CharacterRigNode,
  CharacterRigVersion,
} from "@motionprep/contracts";
import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
} from "@motionprep/contracts";
import { writePsdBuffer, type Layer as PsdLayer, type Psd } from "ag-psd";
import sharp from "sharp";
import { assertDocumentDimensions, MAX_DECODED_PIXELS } from "./document-dimensions.js";
import { ExportAdapterError } from "./export-adapter-error.js";
import {
  clampOpacity,
  createPsdImageResources,
  pixelData,
  withScaledAlpha,
} from "./psd-buffer.js";

export interface CharacterRigRasterAsset {
  nodeId: string;
  source: Buffer;
}

export interface CreateCharacterRigPsdInput {
  rig: CharacterRigVersion;
  width: number;
  height: number;
  assets: readonly CharacterRigRasterAsset[];
  generatedAt: string;
}

export interface CharacterRigPsdResult {
  psd: Buffer;
  manifest: CharacterRigExportManifest;
}

interface PreparedCharacterRaster {
  node: CharacterRigNode;
  pixels: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
}

export async function createCharacterRigPsd(
  input: CreateCharacterRigPsdInput,
): Promise<CharacterRigPsdResult> {
  assertDocumentDimensions(input, true);
  const topology = validateCharacterRigTemplate(input.rig);
  const prepared = await prepareAssets(input, topology.nodesById);
  const compositeInputs: Array<{
    input: Buffer;
    raw: { width: number; height: number; channels: 4 };
    left: number;
    top: number;
  }> = [];
  const manifestNodes: CharacterRigExportManifest["nodes"] = [];

  const buildNode = (
    node: CharacterRigNode,
    parentPath: string,
    ancestorsVisible: boolean,
    ancestorOpacity: number,
  ): PsdLayer => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    manifestNodes.push({
      id: node.id,
      parentId: node.parentId,
      path,
      kind: node.kind,
      canonicalView: node.canonicalView,
      semanticPart: node.semanticPart,
      sourceGenerationAttemptId: node.sourceGenerationAttemptId,
      artifactSha256: node.artifact?.sha256 ?? null,
    });
    const visible = ancestorsVisible && node.visible;
    const opacity = ancestorOpacity * clampOpacity(node.opacity ?? 1);
    if (node.kind === "raster") {
      const item = prepared.get(node.id);
      if (!item) throw templateError(`Raster node ${node.id} has no prepared asset.`);
      if (visible && opacity > 0) {
        compositeInputs.push({
          input: opacity < 1 ? withScaledAlpha(item.pixels, opacity) : item.pixels,
          raw: { width: item.width, height: item.height, channels: 4 },
          left: item.left,
          top: item.top,
        });
      }
      return {
        name: node.name,
        top: item.top,
        left: item.left,
        opacity: clampOpacity(node.opacity ?? 1),
        hidden: !node.visible,
        blendMode: "normal",
        protected: protectionFor(node),
        imageData: pixelData(item.pixels, item.width, item.height),
      };
    }
    const children = (topology.childrenByParent.get(node.id) ?? [])
      .slice()
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((child) => buildNode(child, path, visible, opacity));
    return {
      name: node.name,
      opened: false,
      hidden: !node.visible,
      opacity: clampOpacity(node.opacity ?? 1),
      protected: protectionFor(node),
      children,
    };
  };

  const roots = (topology.childrenByParent.get(null) ?? [])
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((node) => buildNode(node, "", true, 1));
  const composite = await transparentCanvas(input.width, input.height)
    .composite(compositeInputs)
    .raw()
    .toBuffer();
  const psdDocument: Psd = {
    width: input.width,
    height: input.height,
    imageData: pixelData(composite, input.width, input.height),
    children: roots,
    imageResources: createPsdImageResources(),
  };
  return {
    psd: writePsdBuffer(psdDocument, {
      generateThumbnail: false,
      noBackground: true,
      trimImageData: false,
    }),
    manifest: {
      schemaVersion: "1.0",
      rigVersionId: input.rig.id,
      projectId: input.rig.projectId,
      bibleId: input.rig.bibleId,
      canvas: {
        width: input.width,
        height: input.height,
        colorMode: "RGB",
        bitsPerChannel: 8,
      },
      canonicalViews: [...characterCanonicalViews],
      generatedAt: input.generatedAt,
      nodes: manifestNodes,
    },
  };
}

export function validateCharacterRigTemplate(rig: CharacterRigVersion) {
  const nodesById = new Map<string, CharacterRigNode>();
  const childrenByParent = new Map<string | null, CharacterRigNode[]>();
  for (const node of rig.nodes) {
    if (nodesById.has(node.id)) throw templateError(`Duplicate rig node id ${node.id}.`);
    nodesById.set(node.id, node);
    childrenByParent.set(node.parentId, [
      ...(childrenByParent.get(node.parentId) ?? []),
      node,
    ]);
  }
  for (const node of rig.nodes) {
    if (node.parentId === null) continue;
    const parent = nodesById.get(node.parentId);
    if (!parent || parent.kind === "raster") {
      throw templateError(`Rig node ${node.id} has an invalid parent.`);
    }
  }
  assertAcyclic(rig.nodes, nodesById);
  const roots = childrenByParent.get(null) ?? [];
  const root = roots[0];
  if (
    roots.length !== 1 ||
    root?.kind !== "group" ||
    root.semanticPart !== "character-root"
  ) {
    throw templateError("Rig requires exactly one character-root group.");
  }
  for (const view of characterCanonicalViews) {
    const viewGroups = (childrenByParent.get(root.id) ?? []).filter(
      (node) =>
        node.kind === "group" &&
        node.semanticPart === "view" &&
        node.canonicalView === view,
    );
    if (viewGroups.length !== 1) {
      throw templateError(`Rig requires exactly one ${view} view group.`);
    }
    const viewGroup = viewGroups[0];
    if (!viewGroup) throw templateError(`Rig is missing the ${view} view group.`);
    const descendants = descendantsOf(viewGroup.id, childrenByParent);
    const requiredParts = [
      ...characterRequiredHeadParts,
      ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
    ];
    for (const part of requiredParts) {
      const matches = descendants.filter(
        (node) =>
          node.kind === "raster" &&
          node.canonicalView === view &&
          node.semanticPart === part,
      );
      if (matches.length !== 1) {
        throw templateError(`View ${view} requires exactly one ${part} raster.`);
      }
    }
  }
  return { nodesById, childrenByParent };
}

async function prepareAssets(
  input: CreateCharacterRigPsdInput,
  nodesById: ReadonlyMap<string, CharacterRigNode>,
): Promise<Map<string, PreparedCharacterRaster>> {
  const rasterNodes = input.rig.nodes.filter((node) => node.kind === "raster");
  const assets = new Map<string, Buffer>();
  for (const asset of input.assets) {
    if (assets.has(asset.nodeId)) throw templateError(`Duplicate asset for ${asset.nodeId}.`);
    const node = nodesById.get(asset.nodeId);
    if (!node || node.kind !== "raster") {
      throw templateError(`Asset ${asset.nodeId} does not reference a raster node.`);
    }
    assets.set(asset.nodeId, asset.source);
  }
  if (assets.size !== rasterNodes.length) {
    throw templateError("Every raster rig node requires exactly one source asset.");
  }
  const prepared = new Map<string, PreparedCharacterRaster>();
  for (const node of rasterNodes) {
    const source = assets.get(node.id);
    if (!source) throw templateError(`Raster node ${node.id} has no source asset.`);
    if (
      node.artifact &&
      (node.artifact.sizeBytes !== source.byteLength ||
        node.artifact.sha256 !== createHash("sha256").update(source).digest("hex"))
    ) {
      throw templateError(`Raster node ${node.id} failed artifact integrity validation.`);
    }
    let decoded: { data: Buffer; info: { width: number; height: number } };
    try {
      decoded = await sharp(source, {
        failOn: "error",
        limitInputPixels: MAX_DECODED_PIXELS,
      })
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ExportAdapterError(
        "RASTER_DECODE_FAILED",
        `Could not decode character rig asset ${node.id}.`,
      );
    }
    const placement = resolvePlacement(input, node, decoded.info);
    prepared.set(node.id, {
      node,
      pixels: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      ...placement,
    });
  }
  return prepared;
}

function resolvePlacement(
  canvas: { width: number; height: number },
  node: CharacterRigNode,
  decoded: { width: number; height: number },
) {
  if (decoded.width === canvas.width && decoded.height === canvas.height) {
    return { left: 0, top: 0 };
  }
  const bounds = node.bounds;
  if (!bounds) throw templateError(`Raster node ${node.id} requires bounds.`);
  const left = Math.round(bounds.x);
  const top = Math.round(bounds.y);
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (
    left < 0 ||
    top < 0 ||
    width !== decoded.width ||
    height !== decoded.height ||
    left + width > canvas.width ||
    top + height > canvas.height
  ) {
    throw templateError(`Raster node ${node.id} has invalid bounds.`);
  }
  return { left, top };
}

function assertAcyclic(
  nodes: readonly CharacterRigNode[],
  nodesById: ReadonlyMap<string, CharacterRigNode>,
): void {
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: CharacterRigNode | undefined = node;
    while (current) {
      if (visited.has(current.id)) throw templateError("Rig hierarchy contains a cycle.");
      visited.add(current.id);
      current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
  }
}

function descendantsOf(
  parentId: string,
  childrenByParent: ReadonlyMap<string | null, CharacterRigNode[]>,
): CharacterRigNode[] {
  const result: CharacterRigNode[] = [];
  const pending = [...(childrenByParent.get(parentId) ?? [])];
  while (pending.length > 0) {
    const node = pending.shift();
    if (!node) continue;
    result.push(node);
    pending.push(...(childrenByParent.get(node.id) ?? []));
  }
  return result;
}

function protectionFor(node: CharacterRigNode) {
  return {
    position: node.locked,
    composite: node.locked,
    transparency: node.locked,
  };
}

function transparentCanvas(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

function templateError(message: string): ExportAdapterError {
  return new ExportAdapterError("CHARACTER_RIG_TEMPLATE_INVALID", message);
}
