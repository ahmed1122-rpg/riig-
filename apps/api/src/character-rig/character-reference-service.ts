import type {
  CharacterReferenceAsset,
  CharacterReferenceRights,
  CharacterReferenceRole,
  CharacterCanonicalView,
} from "@motionprep/contracts";
import type { ObjectStorage } from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import sharp from "sharp";

const supportedTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
] as const);

export class CharacterReferenceService {
  constructor(
    private readonly characterRigs: CharacterRigRepository,
    private readonly uploads: UploadRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async addCurrentSource(input: {
    projectId: string;
    sourceVersionId: string;
    bibleId: string;
    role: CharacterReferenceRole;
    canonicalView: CharacterCanonicalView | null;
    rightsClassification: CharacterReferenceRights;
    actorUserId: string;
  }): Promise<CharacterReferenceAsset> {
    const bible = await this.characterRigs.findBible(input.projectId, input.bibleId);
    if (!bible) throw new CharacterReferenceError("CHARACTER_BIBLE_NOT_FOUND");
    if (bible.status !== "approved") {
      throw new CharacterReferenceError("CHARACTER_BIBLE_NOT_APPROVED");
    }
    if (
      ["identity-primary", "canonical-view", "part-mask"].includes(input.role) &&
      !input.canonicalView
    ) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_VIEW_REQUIRED");
    }
    const existing = await this.characterRigs.listReferences(
      input.projectId,
      input.bibleId,
    );
    if (existing.length >= 25) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_LIMIT_EXCEEDED");
    }
    const upload = await this.uploads.findReadyBySourceVersion(
      input.projectId,
      input.sourceVersionId,
    );
    if (!upload || !upload.sha256) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_SOURCE_NOT_READY");
    }
    if (
      existing.some(
        (reference) =>
          reference.artifact.sha256 === upload.sha256 &&
          reference.role === input.role &&
          reference.canonicalView === input.canonicalView,
      )
    ) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_DUPLICATE");
    }
    const extension = supportedTypes.get(
      upload.contentType as "image/png" | "image/jpeg" | "image/webp",
    );
    if (!extension) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_TYPE_UNSUPPORTED");
    }
    const source = await this.storage.get(upload.objectKey, {
      maxBytes: upload.expectedSizeBytes,
    });
    if (!source) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_SOURCE_NOT_READY");
    }
    if (
      !hasExpectedObjectIntegrity(source, {
        contentType: upload.contentType,
        sizeBytes: upload.expectedSizeBytes,
        sha256: upload.sha256,
      })
    ) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_SOURCE_INTEGRITY_FAILED");
    }
    const id = crypto.randomUUID();
    const objectKey = `projects/${input.projectId}/character-rig/references/${id}.${extension}`;
    let metadata: { width?: number; height?: number };
    try {
      metadata = await sharp(source.body, {
        failOn: "error",
        limitInputPixels: 25_000_000,
      }).metadata();
    } catch {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_DECODE_FAILED");
    }
    if (!metadata.width || !metadata.height) {
      throw new CharacterReferenceError("CHARACTER_REFERENCE_DECODE_FAILED");
    }
    const stored = await this.storage.put({
      key: objectKey,
      contentType: upload.contentType,
      sizeBytes: source.sizeBytes,
      body: source.body,
    });
    const createdAt = this.now();
    const reference: CharacterReferenceAsset = {
      id,
      projectId: input.projectId,
      bibleId: input.bibleId,
      role: input.role,
      canonicalView: input.canonicalView,
      rightsClassification: input.rightsClassification,
      rightsAttestedByUserId: input.actorUserId,
      rightsAttestedAt: createdAt.toISOString(),
      artifact: {
        objectKey: stored.key,
        contentType: upload.contentType as "image/png" | "image/jpeg" | "image/webp",
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        createdAt: createdAt.toISOString(),
        retentionExpiresAt: new Date(
          createdAt.getTime() + 90 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      },
      width: metadata.width,
      height: metadata.height,
      createdAt: createdAt.toISOString(),
    };
    try {
      if (!(await this.characterRigs.addReference(reference))) {
        throw new CharacterReferenceError("CHARACTER_REFERENCE_CONFLICT");
      }
      return reference;
    } catch (error) {
      await this.storage.purge([objectKey], []);
      throw error;
    }
  }
}

export class CharacterReferenceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
