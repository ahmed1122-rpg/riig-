import { createHash } from "node:crypto";
import type {
  CharacterRigExportManifest,
  CharacterRigNode,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { writePsdBuffer, type Layer as PsdLayer, type Psd } from "ag-psd";
import { assertDocumentDimensions } from "./document-dimensions.js";
import { ExportAdapterError } from "./export-adapter-error.js";
import {
  clampOpacity,
  createPsdImageResources,
  pixelData,
  withScaledAlpha,
} from "./psd-buffer.js";
import { decodeRasterRgba, transparentCanvas } from "./raster-utils.js";

export interface CharacterRigRasterAsset {
  nodeId: string;
  source: Buffer;
}

export interface CreateCharacterRigPsdInput {
  rig: CharacterRigVersion;
  width: number;
  height: number;
  assets: readonly CharacterRigRasterAsset[];
  /** Original uploaded image used for pixel-identity verification. */
  source: Buffer;
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
      sourceLayerId: node.sourceLayerId,
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
  await verifySourceComposite(input, composite);
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
      canonicalViews: ["frontal"],
      generatedAt: input.generatedAt,
      sourceIntegrity: {
        mode: "pixel-exact",
        sourceVersionId: input.rig.source.sourceVersionId,
        sourceSha256: input.rig.source.artifact.sha256,
        verified: true,
      },
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
  validateSourcePreservingTemplate(rig, root, childrenByParent);
  return { nodesById, childrenByParent };
}

function validateSourcePreservingTemplate(
  rig: CharacterRigVersion,
  root: CharacterRigNode,
  childrenByParent: ReadonlyMap<string | null, CharacterRigNode[]>,
): void {
  if (!rig.source?.pixelIdentityRequired) {
    throw templateError("Source-preserving rig requires an immutable source artifact.");
  }
  const viewGroups = (childrenByParent.get(root.id) ?? []).filter(
    (node) => node.kind === "group" && node.semanticPart === "view",
  );
  if (
    viewGroups.length !== 1 ||
    viewGroups[0]?.canonicalView !== "frontal"
  ) {
    throw templateError("Source-preserving rig requires one frontal source group.");
  }
  const rasterNodes = rig.nodes.filter((node) => node.kind === "raster");
  if (rasterNodes.length === 0) {
    throw templateError("Source-preserving rig requires at least one raster layer.");
  }
  const sourceLayerIds = new Set<string>();
  for (const node of rig.nodes) {
    if (node.kind !== "raster") continue;
    if (!node.sourceLayerId) {
      throw templateError("Every source raster must point to a source layer only.");
    }
    if (sourceLayerIds.has(node.sourceLayerId)) {
      throw templateError(`Duplicate source layer ${node.sourceLayerId}.`);
    }
    sourceLayerIds.add(node.sourceLayerId);
  }
}

async function verifySourceComposite(
  input: CreateCharacterRigPsdInput,
  composite: Buffer,
): Promise<void> {
  const sourceMetadata = input.rig.source.artifact;
  if (
    input.source.byteLength !== sourceMetadata.sizeBytes ||
    createHash("sha256").update(input.source).digest("hex") !== sourceMetadata.sha256
  ) {
    throw new ExportAdapterError(
      "CHARACTER_SOURCE_INTEGRITY_FAILED",
      "The original uploaded source failed integrity verification.",
    );
  }
  const decoded = await decodeRasterRgba(
    input.source,
    "CHARACTER_SOURCE_DECODE_FAILED",
    "Could not decode the original uploaded source.",
  );
  if (
    decoded.info.width !== input.width ||
    decoded.info.height !== input.height
  ) {
    throw new ExportAdapterError(
      "CHARACTER_SOURCE_CANVAS_MISMATCH",
      "The uploaded source does not match the rig canvas.",
    );
  }
  if (!composite.equals(decoded.data)) {
    throw new ExportAdapterError(
      "CHARACTER_SOURCE_COMPOSITE_MISMATCH",
      "Visible rig layers do not reproduce the uploaded source pixel-for-pixel.",
    );
  }
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
    const decoded = await decodeRasterRgba(
      source,
      "RASTER_DECODE_FAILED",
      `Could not decode character rig asset ${node.id}.`,
    );
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

function protectionFor(node: CharacterRigNode) {
  return {
    position: node.locked,
    composite: node.locked,
    transparency: node.locked,
  };
}

function templateError(message: string): ExportAdapterError {
  return new ExportAdapterError("CHARACTER_RIG_TEMPLATE_INVALID", message);
}
