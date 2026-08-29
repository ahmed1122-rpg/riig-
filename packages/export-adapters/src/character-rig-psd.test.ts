import { createHash } from "node:crypto";
import type { CharacterRigNode, CharacterRigVersion } from "@motionprep/contracts";
import { readPsd } from "ag-psd";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  createCharacterRigPsd,
  validateCharacterRigTemplate,
} from "./character-rig-psd.js";

const generatedAt = "2026-08-11T00:00:00.000Z";

describe("createCharacterRigPsd", () => {
  it("writes one source hierarchy and records verified pixel identity", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const rig = makeRig(source, source);
    const result = await createCharacterRigPsd({
      rig,
      width: 2,
      height: 2,
      assets: assetsFor(rig, source),
      source,
      generatedAt,
    });

    const decoded = readPsd(result.psd, {
      skipCompositeImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
    });
    expect(decoded).toMatchObject({
      width: 2,
      height: 2,
      colorMode: 3,
      bitsPerChannel: 8,
    });
    const root = decoded.children?.find((node) => node.name === "+Character");
    expect(root?.children?.map((node) => node.name)).toEqual(["+Frontal"]);
    expect(root?.children?.[0]?.children?.map((node) => node.name)).toEqual([
      "+Source",
    ]);
    expect(result.manifest).toMatchObject({
      schemaVersion: "1.0",
      rigVersionId: rig.id,
      canonicalViews: ["frontal"],
      sourceIntegrity: {
        mode: "pixel-exact",
        sourceVersionId: rig.source.sourceVersionId,
        sourceSha256: sha256(source),
        verified: true,
      },
    });
    expect(result.manifest.nodes).toHaveLength(3);
  });

  it("fails closed when source layers change even one visible pixel", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const changedLayer = await tinyPng({ r: 21, g: 40, b: 60 });
    const rig = makeRig(source, changedLayer);

    await expect(
      createCharacterRigPsd({
        rig,
        width: 2,
        height: 2,
        assets: assetsFor(rig, changedLayer),
        source,
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_SOURCE_COMPOSITE_MISMATCH" });
  });

  it("rejects source and layer integrity drift before export", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const sourceDrift = makeRig(source, source);
    sourceDrift.source.artifact.sha256 = "0".repeat(64);
    await expect(
      createCharacterRigPsd({
        rig: sourceDrift,
        width: 2,
        height: 2,
        assets: assetsFor(sourceDrift, source),
        source,
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_SOURCE_INTEGRITY_FAILED" });

    const layerDrift = makeRig(source, source);
    const raster = layerDrift.nodes.find((node) => node.kind === "raster");
    if (!raster?.artifact) throw new Error("Expected raster fixture.");
    raster.artifact.sha256 = "f".repeat(64);
    await expect(
      createCharacterRigPsd({
        rig: layerDrift,
        width: 2,
        height: 2,
        assets: assetsFor(layerDrift, source),
        source,
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_RIG_TEMPLATE_INVALID" });
  });

  it("rejects cycles, duplicate nodes, invalid parents, and missing source layers", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const cyclic = makeRig(source, source);
    cyclic.nodes[0]!.parentId = cyclic.nodes[1]!.id;
    expect(() => validateCharacterRigTemplate(cyclic)).toThrow(/cycle/u);

    const duplicate = makeRig(source, source);
    duplicate.nodes.push({ ...duplicate.nodes[2]! });
    expect(() => validateCharacterRigTemplate(duplicate)).toThrow(/Duplicate/u);

    const invalidParent = makeRig(source, source);
    invalidParent.nodes[2]!.parentId = crypto.randomUUID();
    expect(() => validateCharacterRigTemplate(invalidParent)).toThrow(
      /invalid parent/u,
    );

    const missingSourceLayer = makeRig(source, source);
    missingSourceLayer.nodes[2]!.sourceLayerId = null;
    expect(() => validateCharacterRigTemplate(missingSourceLayer)).toThrow(
      /source layer/u,
    );
  });

  it("requires exactly one asset per source raster", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const rig = makeRig(source, source);
    await expect(
      createCharacterRigPsd({
        rig,
        width: 2,
        height: 2,
        assets: [],
        source,
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_RIG_TEMPLATE_INVALID" });
  });

  it("accepts bounded source layers and hidden layers when the composite stays exact", async () => {
    const redPixel = await rgbaPng(1, 1, [255, 0, 0, 255]);
    const offsetSource = await rgbaPng(2, 2, [
      0, 0, 0, 0, 255, 0, 0, 255,
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const offsetRig = makeRig(offsetSource, redPixel);
    const offsetRaster = offsetRig.nodes.find((node) => node.kind === "raster")!;
    offsetRaster.bounds = { x: 1, y: 0, width: 1, height: 1 };
    await expect(createCharacterRigPsd({
      rig: offsetRig,
      width: 2,
      height: 2,
      assets: assetsFor(offsetRig, redPixel),
      source: offsetSource,
      generatedAt,
    })).resolves.toMatchObject({ manifest: { sourceIntegrity: { verified: true } } });

    const transparent = await rgbaPng(2, 2, new Array(16).fill(0));
    const hiddenLayer = await tinyPng({ r: 20, g: 40, b: 60 });
    const hiddenRig = makeRig(transparent, hiddenLayer);
    hiddenRig.nodes.find((node) => node.kind === "raster")!.visible = false;
    await expect(createCharacterRigPsd({
      rig: hiddenRig,
      width: 2,
      height: 2,
      assets: assetsFor(hiddenRig, hiddenLayer),
      source: transparent,
      generatedAt,
    })).resolves.toMatchObject({ manifest: { sourceIntegrity: { verified: true } } });
  });

  it("rejects malformed source-only topology variants", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });

    const noSource = makeRig(source, source);
    (noSource.source as { pixelIdentityRequired: boolean }).pixelIdentityRequired = false;
    expect(() => validateCharacterRigTemplate(noSource)).toThrow(/immutable source/u);

    const invalidRoot = makeRig(source, source);
    invalidRoot.nodes[0]!.semanticPart = "not-the-root";
    expect(() => validateCharacterRigTemplate(invalidRoot)).toThrow(/character-root/u);

    const invalidView = makeRig(source, source);
    invalidView.nodes[1]!.semanticPart = "not-a-view";
    expect(() => validateCharacterRigTemplate(invalidView)).toThrow(/frontal source group/u);

    const noRaster = makeRig(source, source);
    noRaster.nodes.pop();
    expect(() => validateCharacterRigTemplate(noRaster)).toThrow(/at least one raster/u);

    const duplicateLayer = makeRig(source, source);
    duplicateLayer.nodes.push({
      ...duplicateLayer.nodes[2]!,
      id: crypto.randomUUID(),
      name: "+Duplicate",
    });
    expect(() => validateCharacterRigTemplate(duplicateLayer)).toThrow(/Duplicate source layer/u);
  });

  it("rejects invalid asset mappings, raster bytes, and bounds", async () => {
    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const duplicateAssetsRig = makeRig(source, source);
    const assets = assetsFor(duplicateAssetsRig, source);
    await expect(createCharacterRigPsd({
      rig: duplicateAssetsRig,
      width: 2,
      height: 2,
      assets: [assets[0]!, assets[0]!],
      source,
      generatedAt,
    })).rejects.toThrow(/Duplicate asset/u);

    const groupAssetRig = makeRig(source, source);
    await expect(createCharacterRigPsd({
      rig: groupAssetRig,
      width: 2,
      height: 2,
      assets: [{ nodeId: groupAssetRig.nodes[0]!.id, source }],
      source,
      generatedAt,
    })).rejects.toThrow(/does not reference a raster/u);

    const invalidBytes = Buffer.from("not-an-image");
    const invalidRasterRig = makeRig(source, invalidBytes);
    await expect(createCharacterRigPsd({
      rig: invalidRasterRig,
      width: 2,
      height: 2,
      assets: assetsFor(invalidRasterRig, invalidBytes),
      source,
      generatedAt,
    })).rejects.toMatchObject({ code: "RASTER_DECODE_FAILED" });

    const smallLayer = await rgbaPng(1, 1, [255, 0, 0, 255]);
    const invalidBoundsRig = makeRig(source, smallLayer);
    invalidBoundsRig.nodes[2]!.bounds = { x: -1, y: 0, width: 1, height: 1 };
    await expect(createCharacterRigPsd({
      rig: invalidBoundsRig,
      width: 2,
      height: 2,
      assets: assetsFor(invalidBoundsRig, smallLayer),
      source,
      generatedAt,
    })).rejects.toThrow(/invalid bounds/u);
  });

  it("reports source decode and canvas failures separately", async () => {
    const layer = await tinyPng({ r: 20, g: 40, b: 60 });
    const invalidSource = Buffer.from("not-an-image");
    const decodeRig = makeRig(invalidSource, layer);
    await expect(createCharacterRigPsd({
      rig: decodeRig,
      width: 2,
      height: 2,
      assets: assetsFor(decodeRig, layer),
      source: invalidSource,
      generatedAt,
    })).rejects.toMatchObject({ code: "CHARACTER_SOURCE_DECODE_FAILED" });

    const source = await tinyPng({ r: 20, g: 40, b: 60 });
    const canvasRig = makeRig(source, source);
    await expect(createCharacterRigPsd({
      rig: canvasRig,
      width: 3,
      height: 3,
      assets: assetsFor(canvasRig, source),
      source,
      generatedAt,
    })).rejects.toMatchObject({ code: "CHARACTER_SOURCE_CANVAS_MISMATCH" });
  });
});

function makeRig(source: Buffer, layer: Buffer): CharacterRigVersion {
  const projectId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const viewId = crypto.randomUUID();
  const sourceLayerId = crypto.randomUUID();
  const nodes: CharacterRigNode[] = [
    makeNode({
      id: rootId,
      parentId: null,
      kind: "group",
      name: "+Character",
      canonicalView: null,
      semanticPart: "character-root",
      sourceLayerId: null,
      zIndex: 0,
    }),
    makeNode({
      id: viewId,
      parentId: rootId,
      kind: "group",
      name: "+Frontal",
      canonicalView: "frontal",
      semanticPart: "view",
      sourceLayerId: null,
      zIndex: 0,
    }),
    {
      ...makeNode({
        id: crypto.randomUUID(),
        parentId: viewId,
        kind: "raster",
        name: "+Source",
        canonicalView: "frontal",
        semanticPart: "source",
        sourceLayerId,
        zIndex: 0,
      }),
      artifact: artifact(`projects/${projectId}/derived/${sourceLayerId}.png`, layer),
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    },
  ];
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    bibleId: crypto.randomUUID(),
    version: 1,
    status: "draft",
    pipeline: "source-preserving",
    failureCode: null,
    sourceFingerprint: sha256(source),
    source: {
      sourceVersionId: crypto.randomUUID(),
      referenceId: crypto.randomUUID(),
      artifact: artifact(`projects/${projectId}/character-rig/source.png`, source),
      layerDocumentRevision: 1,
      pixelIdentityRequired: true,
    },
    canvas: { width: 2, height: 2 },
    nodes,
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function makeNode(
  input: Pick<
    CharacterRigNode,
    | "id"
    | "parentId"
    | "kind"
    | "name"
    | "canonicalView"
    | "semanticPart"
    | "sourceLayerId"
    | "zIndex"
  >,
): CharacterRigNode {
  return {
    ...input,
    artifact: null,
    bounds: null,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

function artifact(objectKey: string, body: Buffer) {
  return {
    objectKey,
    contentType: "image/png" as const,
    sizeBytes: body.byteLength,
    sha256: sha256(body),
    createdAt: generatedAt,
    retentionExpiresAt: null,
  };
}

function assetsFor(rig: CharacterRigVersion, source: Buffer) {
  return rig.nodes
    .filter((node) => node.kind === "raster")
    .map((node) => ({ nodeId: node.id, source }));
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function tinyPng(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { ...color, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function rgbaPng(
  width: number,
  height: number,
  pixels: number[],
): Promise<Buffer> {
  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
