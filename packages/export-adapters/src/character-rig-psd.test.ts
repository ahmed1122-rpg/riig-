import type {
  CharacterRigNode,
  CharacterRigVersion,
} from "@motionprep/contracts";
import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
} from "@motionprep/contracts";
import { readPsd } from "ag-psd";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createCharacterRigPsd, validateCharacterRigTemplate } from "./character-rig-psd.js";

const generatedAt = "2026-08-11T00:00:00.000Z";

describe("createCharacterRigPsd", () => {
  it("writes the complete five-view hierarchy and deterministic manifest", async () => {
    const rig = makeRig();
    const source = await tinyPng();
    const result = await createCharacterRigPsd({
      rig,
      width: 2,
      height: 2,
      assets: rig.nodes
        .filter((node) => node.kind === "raster")
        .map((node) => ({ nodeId: node.id, source })),
      generatedAt,
    });

    const decoded = readPsd(result.psd, {
      skipCompositeImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
    });
    expect(decoded).toMatchObject({ width: 2, height: 2, colorMode: 3, bitsPerChannel: 8 });
    const root = decoded.children?.find((node) => node.name === "+Character");
    expect(root?.children?.map((node) => node.name)).toEqual([
      "+Frontal",
      "+Left Quarter",
      "+Left Profile",
      "+Right Quarter",
      "+Right Profile",
    ]);
    expect(
      root?.children
        ?.find((node) => node.name === "+Frontal")
        ?.children?.map((node) => node.name),
    ).toContain("+Left Hand");
    expect(result.manifest).toMatchObject({
      schemaVersion: "1.0",
      rigVersionId: rig.id,
      generatedAt,
      canvas: { width: 2, height: 2, colorMode: "RGB", bitsPerChannel: 8 },
      canonicalViews: characterCanonicalViews,
    });
    expect(result.manifest.nodes).toHaveLength(rig.nodes.length);
    expect(result.manifest.nodes[1]?.path).toBe("+Character/+Frontal");
  });

  it("rejects a missing required part before decoding assets", () => {
    const rig = makeRig();
    rig.nodes = rig.nodes.filter(
      (node) => !(node.canonicalView === "right-profile" && node.semanticPart === "mouth"),
    );
    expect(() => validateCharacterRigTemplate(rig)).toThrow(/requires exactly one mouth/u);
  });

  it("rejects cycles and assets that are not bound one-to-one", async () => {
    const cyclic = makeRig();
    const root = cyclic.nodes.find((node) => node.semanticPart === "character-root");
    const frontal = cyclic.nodes.find(
      (node) => node.semanticPart === "view" && node.canonicalView === "frontal",
    );
    if (!root || !frontal) throw new Error("Fixture is incomplete.");
    root.parentId = frontal.id;
    expect(() => validateCharacterRigTemplate(cyclic)).toThrow(/cycle/u);

    const rig = makeRig();
    await expect(
      createCharacterRigPsd({
        rig,
        width: 2,
        height: 2,
        assets: [],
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_RIG_TEMPLATE_INVALID" });
  });

  it("rejects duplicate nodes, invalid parents, roots, and view groups", () => {
    const duplicate = makeRig();
    duplicate.nodes.push({ ...duplicate.nodes[0]! });
    expect(() => validateCharacterRigTemplate(duplicate)).toThrow(/Duplicate rig node/u);

    const missingParent = makeRig();
    missingParent.nodes[1]!.parentId = crypto.randomUUID();
    expect(() => validateCharacterRigTemplate(missingParent)).toThrow(/invalid parent/u);

    const rasterParent = makeRig();
    const raster = rasterParent.nodes.find((node) => node.kind === "raster")!;
    rasterParent.nodes[1]!.parentId = raster.id;
    expect(() => validateCharacterRigTemplate(rasterParent)).toThrow(/invalid parent/u);

    const extraRoot = makeRig();
    extraRoot.nodes[1]!.parentId = null;
    expect(() => validateCharacterRigTemplate(extraRoot)).toThrow(/exactly one character-root/u);

    const duplicateView = makeRig();
    const frontal = duplicateView.nodes.find(
      (node) => node.semanticPart === "view" && node.canonicalView === "frontal",
    )!;
    duplicateView.nodes.push({ ...frontal, id: crypto.randomUUID() });
    expect(() => validateCharacterRigTemplate(duplicateView)).toThrow(
      /exactly one frontal view/u,
    );
  });

  it("rejects duplicate, unrelated, corrupt, and undecodable raster assets", async () => {
    const source = await tinyPng();
    const duplicateAssetsRig = makeRig();
    const raster = duplicateAssetsRig.nodes.find((node) => node.kind === "raster")!;
    await expect(
      createCharacterRigPsd({
        rig: duplicateAssetsRig,
        width: 2,
        height: 2,
        assets: [
          { nodeId: raster.id, source },
          { nodeId: raster.id, source },
        ],
        generatedAt,
      }),
    ).rejects.toThrow(/Duplicate asset/u);

    const unrelatedRig = makeRig();
    await expect(
      createCharacterRigPsd({
        rig: unrelatedRig,
        width: 2,
        height: 2,
        assets: [{ nodeId: unrelatedRig.nodes[0]!.id, source }],
        generatedAt,
      }),
    ).rejects.toThrow(/does not reference a raster/u);

    const corruptRig = makeRig();
    const corruptRaster = corruptRig.nodes.find((node) => node.kind === "raster")!;
    corruptRaster.artifact = {
      objectKey: "character/corrupt.png",
      contentType: "image/png",
      sizeBytes: source.byteLength,
      sha256: "0".repeat(64),
      createdAt: generatedAt,
      retentionExpiresAt: null,
    };
    await expect(
      createCharacterRigPsd({
        rig: corruptRig,
        width: 2,
        height: 2,
        assets: assetsFor(corruptRig, source),
        generatedAt,
      }),
    ).rejects.toThrow(/integrity validation/u);

    const undecodableRig = makeRig();
    await expect(
      createCharacterRigPsd({
        rig: undecodableRig,
        width: 2,
        height: 2,
        assets: assetsFor(undecodableRig, Buffer.from("not an image")),
        generatedAt,
      }),
    ).rejects.toMatchObject({ code: "RASTER_DECODE_FAILED" });
  });

  it("places bounded part assets and rejects missing or unsafe bounds", async () => {
    const source = await tinyPng();
    const bounded = makeRig();
    for (const node of bounded.nodes) {
      if (node.kind === "raster") {
        node.bounds = { x: 1, y: 1, width: 2, height: 2 };
      }
    }
    await expect(
      createCharacterRigPsd({
        rig: bounded,
        width: 4,
        height: 4,
        assets: assetsFor(bounded, source),
        generatedAt,
      }),
    ).resolves.toMatchObject({ manifest: { canvas: { width: 4, height: 4 } } });

    const missingBounds = makeRig();
    await expect(
      createCharacterRigPsd({
        rig: missingBounds,
        width: 4,
        height: 4,
        assets: assetsFor(missingBounds, source),
        generatedAt,
      }),
    ).rejects.toThrow(/requires bounds/u);

    const unsafeBounds = makeRig();
    for (const node of unsafeBounds.nodes) {
      if (node.kind === "raster") {
        node.bounds = { x: 3, y: 3, width: 2, height: 2 };
      }
    }
    await expect(
      createCharacterRigPsd({
        rig: unsafeBounds,
        width: 4,
        height: 4,
        assets: assetsFor(unsafeBounds, source),
        generatedAt,
      }),
    ).rejects.toThrow(/invalid bounds/u);
  });
});

function assetsFor(rig: CharacterRigVersion, source: Buffer) {
  return rig.nodes
    .filter((node) => node.kind === "raster")
    .map((node) => ({ nodeId: node.id, source }));
}

function makeRig(): CharacterRigVersion {
  const projectId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const nodes: CharacterRigNode[] = [
    makeNode({
      id: rootId,
      parentId: null,
      kind: "group",
      name: "+Character",
      canonicalView: null,
      semanticPart: "character-root",
      zIndex: 0,
    }),
  ];
  characterCanonicalViews.forEach((view, viewIndex) => {
    const viewId = crypto.randomUUID();
    nodes.push(
      makeNode({
        id: viewId,
        parentId: rootId,
        kind: "group",
        name: `+${titleCase(view)}`,
        canonicalView: view,
        semanticPart: "view",
        zIndex: viewIndex,
      }),
    );
    const parts = [
      ...characterRequiredHeadParts,
      ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
    ];
    parts.forEach((part, partIndex) => {
      nodes.push(
        makeNode({
          id: crypto.randomUUID(),
          parentId: viewId,
          kind: "raster",
          name: `+${titleCase(part)}`,
          canonicalView: view,
          semanticPart: part,
          zIndex: partIndex,
        }),
      );
    });
  });
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    bibleId: crypto.randomUUID(),
    version: 1,
    status: "approved",
    nodes,
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: crypto.randomUUID(),
    approvedAt: generatedAt,
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
    | "zIndex"
  >,
): CharacterRigNode {
  return {
    ...input,
    sourceGenerationAttemptId: input.kind === "raster" ? crypto.randomUUID() : null,
    artifact: null,
    bounds: null,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function tinyPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 20, g: 40, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}
