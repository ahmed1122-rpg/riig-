import type {
  CharacterBible,
  CharacterMaterialDefinition,
  CharacterPaletteEntry,
  CharacterProportionProfile,
} from "@motionprep/contracts";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export interface SaveCharacterBibleDraftInput {
  projectId: string;
  bibleId: string | null;
  expectedRevision: number | null;
  displayName: string;
  identityDescription: string;
  negativeConstraints: string[];
  distinguishingFeatures: string[];
  proportions: CharacterProportionProfile;
  palette: CharacterPaletteEntry[];
  materials: CharacterMaterialDefinition[];
  actorUserId: string;
  updatedAt: string;
}

export class CharacterBibleService {
  constructor(private readonly repository: CharacterRigRepository) {}

  async saveDraft(input: SaveCharacterBibleDraftInput): Promise<CharacterBible> {
    const current = input.bibleId
      ? await this.repository.findBible(input.projectId, input.bibleId)
      : null;
    if (input.bibleId && !current) {
      throw new CharacterBibleError("CHARACTER_BIBLE_NOT_FOUND");
    }
    if (current?.status !== undefined && current.status !== "draft") {
      throw new CharacterBibleError("CHARACTER_BIBLE_IMMUTABLE");
    }
    if (
      (current && input.expectedRevision !== current.revision) ||
      (!current && input.expectedRevision !== null)
    ) {
      throw new CharacterBibleError("CHARACTER_BIBLE_REVISION_CONFLICT");
    }
    const latest = current
      ? null
      : await this.repository.findLatestBible(input.projectId);
    const bible: CharacterBible = {
      schemaVersion: "1.0",
      id: current?.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      version: current?.version ?? (latest?.version ?? 0) + 1,
      revision: current ? current.revision + 1 : 1,
      status: "draft",
      displayName: input.displayName,
      identityDescription: input.identityDescription,
      negativeConstraints: structuredClone(input.negativeConstraints),
      distinguishingFeatures: structuredClone(input.distinguishingFeatures),
      proportions: structuredClone(input.proportions),
      palette: structuredClone(input.palette),
      materials: structuredClone(input.materials),
      createdByUserId: current?.createdByUserId ?? input.actorUserId,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: current?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    };
    const saved = await this.repository.saveBibleIfRevision(
      bible,
      current?.revision ?? null,
    );
    if (!saved) throw new CharacterBibleError("CHARACTER_BIBLE_REVISION_CONFLICT");
    return bible;
  }

  async approve(input: {
    projectId: string;
    bibleId: string;
    expectedRevision: number;
    actorUserId: string;
    approvedAt: string;
  }): Promise<CharacterBible> {
    const current = await this.repository.findBible(input.projectId, input.bibleId);
    if (!current) throw new CharacterBibleError("CHARACTER_BIBLE_NOT_FOUND");
    if (
      current.status === "approved" &&
      current.revision === input.expectedRevision + 1
    ) {
      return current;
    }
    if (current.status !== "draft") {
      throw new CharacterBibleError("CHARACTER_BIBLE_IMMUTABLE");
    }
    if (current.revision !== input.expectedRevision) {
      throw new CharacterBibleError("CHARACTER_BIBLE_REVISION_CONFLICT");
    }
    if (
      current.negativeConstraints.length === 0 ||
      current.distinguishingFeatures.length === 0 ||
      current.palette.length === 0
    ) {
      throw new CharacterBibleError("CHARACTER_BIBLE_INCOMPLETE");
    }
    const approved: CharacterBible = {
      ...current,
      revision: current.revision + 1,
      status: "approved",
      approvedByUserId: input.actorUserId,
      approvedAt: input.approvedAt,
      updatedAt: input.approvedAt,
    };
    if (!(await this.repository.saveBibleIfRevision(approved, current.revision))) {
      throw new CharacterBibleError("CHARACTER_BIBLE_REVISION_CONFLICT");
    }
    return approved;
  }
}

export class CharacterBibleError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
