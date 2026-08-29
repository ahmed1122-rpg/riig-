import type {
  CharacterBible,
  CharacterReferenceAsset,
  LayerDocument,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryLayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const now = "2026-08-28T00:00:00.000Z";

describe("CharacterRigCompilerService", () => {
  it("creates a new source-preserving rig when a source layer changes", async () => {
    const setup = await compilerFixture();
    const first = await setup.service.queue(compileInput(setup, "compile-first"));
    const [left, right] = setup.document.layers;
    if (!left?.rasterAsset || !right?.rasterAsset) {
      throw new Error("Expected source raster assets.");
    }
    const changed: LayerDocument = {
      ...setup.document,
      revision: 2,
      layers: [
        { ...left, rasterAsset: right.rasterAsset },
        { ...right, rasterAsset: left.rasterAsset },
      ],
    };
    await setup.documents.save(changed);

    const second = await setup.service.queue(
      compileInput(setup, "compile-changed"),
    );

    expect(first.rig.pipeline).toBe("source-preserving");
    expect(
      first.rig.nodes
        .filter((node) => node.kind === "raster")
        .every((node) => Boolean(node.sourceLayerId)),
    ).toBe(true);
    expect(second.replayed).toBe(false);
    expect(second.rig.id).not.toBe(first.rig.id);
  });

  it("rejects a canvas that differs from the immutable source", async () => {
    const setup = await compilerFixture();

    await expect(
      setup.service.queue({
        ...compileInput(setup, "compile-wrong-size"),
        width: 4,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_SOURCE_CANVAS_MISMATCH" });
  });

  it("fails closed for malformed or unsupported source layer documents", async () => {
    await expectInvalidDocument(
      (document) => ({ ...document, revision: 0 }),
      "CHARACTER_SOURCE_REVISION_INVALID",
    );
    await expectInvalidDocument(
      (document) => ({ ...document, layers: [] }),
      "CHARACTER_SOURCE_LAYERS_EMPTY",
    );
    await expectInvalidDocument(
      (document) => {
        const { rasterAsset: _rasterAsset, ...layer } = document.layers[0]!;
        return {
          ...document,
          layers: [{ ...layer, kind: "text", fullText: "source" }],
        };
      },
      "CHARACTER_SOURCE_LAYER_KIND_UNSUPPORTED",
    );
    await expectInvalidDocument(
      (document) => ({
        ...document,
        layers: [{ ...document.layers[0]!, parentId: crypto.randomUUID() }],
      }),
      "CHARACTER_SOURCE_LAYER_PARENT_INVALID",
    );
    await expectInvalidDocument(
      (document) => {
        const { rasterAsset: _rasterAsset, ...layer } = document.layers[0]!;
        return { ...document, layers: [layer] };
      },
      "CHARACTER_SOURCE_LAYER_INVALID",
    );
    await expectInvalidDocument(
      (document) => {
        const {
          rasterAsset: _rasterAsset,
          bounds: _bounds,
          ...layer
        } = document.layers[0]!;
        return { ...document, layers: [{ ...layer, kind: "group" }] };
      },
      "CHARACTER_SOURCE_RASTER_REQUIRED",
    );
  });
});

async function expectInvalidDocument(
  mutate: (document: LayerDocument) => LayerDocument,
  code: string,
) {
  const setup = await compilerFixture();
  await setup.documents.save(mutate({ ...setup.document, revision: 2 }));
  await expect(
    setup.service.queue(compileInput(setup, `invalid-${code.toLowerCase()}`)),
  ).rejects.toMatchObject({ code });
}

async function compilerFixture() {
  const projectId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rigs = new InMemoryCharacterRigRepository();
  const documents = new InMemoryLayerDocumentRepository();
  const bible: CharacterBible = {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Source fixture",
    identityDescription: "The uploaded image is the only visual source of truth.",
    negativeConstraints: ["Never synthesize pixels"],
    distinguishingFeatures: ["Preserve every uploaded pixel"],
    proportions: {
      headToBodyHeightRatio: 0.2,
      shoulderToBodyHeightRatio: 0.25,
      eyeSpacingToFaceWidthRatio: 0.22,
      notes: [],
    },
    palette: [],
    materials: [],
    createdByUserId: userId,
    approvedByUserId: userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await rigs.saveBibleIfRevision(bible, null);
  const reference: CharacterReferenceAsset = {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    sourceVersionId,
    role: "identity-primary",
    canonicalView: "frontal",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: userId,
    rightsAttestedAt: now,
    artifact: {
      objectKey: `projects/${projectId}/source.png`,
      contentType: "image/png",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      createdAt: now,
      retentionExpiresAt: null,
    },
    width: 2,
    height: 1,
    createdAt: now,
  };
  await rigs.addReference(reference);
  const document: LayerDocument = {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: now,
    width: 2,
    height: 1,
    colorSpace: "sRGB",
    layers: [
      rasterLayer("layer-left", 0, "b"),
      rasterLayer("layer-right", 1, "c"),
    ],
  };
  await documents.save(document);
  return {
    projectId,
    sourceVersionId,
    bible,
    rigs,
    documents,
    document,
    service: new CharacterRigCompilerService(
      rigs,
      new InMemoryCharacterJobRepository(),
      documents,
    ),
  };
}

function rasterLayer(id: string, x: number, hashPrefix: string) {
  return {
    id,
    parentId: null,
    kind: "raster" as const,
    name: `+${id}` as `+${string}`,
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: x,
    bounds: { x, y: 0, width: 1, height: 1 },
    rasterAsset: {
      objectKey: `layers/${id}.png`,
      contentType: "image/png" as const,
      sizeBytes: 1,
      sha256: hashPrefix.repeat(64),
    },
  };
}

function compileInput(
  setup: Awaited<ReturnType<typeof compilerFixture>>,
  idempotencyKey: string,
) {
  return {
    projectId: setup.projectId,
    sourceVersionId: setup.sourceVersionId,
    bibleId: setup.bible.id,
    width: 2,
    height: 1,
    idempotencyKey,
    requestedAt: now,
  };
}
