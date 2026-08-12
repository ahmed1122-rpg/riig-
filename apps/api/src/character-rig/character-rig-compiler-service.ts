import type {
  CharacterCanonicalView,
  CharacterGenerationAttempt,
  CharacterRigNode,
  CharacterRigVersion,
} from "@motionprep/contracts";
import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
} from "@motionprep/contracts";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterJobService } from "./character-job-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export interface QueueCharacterRigCompilationInput {
  projectId: string;
  bibleId: string;
  width: number;
  height: number;
  idempotencyKey: string;
  requestedAt: string;
}

export class CharacterRigCompilerService {
  readonly #jobs: CharacterJobService;

  constructor(
    private readonly repository: CharacterRigRepository,
    jobs: CharacterJobRepository,
  ) {
    this.#jobs = new CharacterJobService(jobs);
  }

  async queue(input: QueueCharacterRigCompilationInput) {
    const bible = await this.repository.findBible(input.projectId, input.bibleId);
    if (!bible || bible.status !== "approved") {
      throw new CharacterRigCompilerError("CHARACTER_BIBLE_NOT_APPROVED");
    }
    const attempts = await this.repository.listGenerationAttempts(
      input.projectId,
      bible.id,
    );
    const approvedParts = indexApprovedParts(attempts);
    const missing = requiredPartKeys().filter((key) => !approvedParts.has(key));
    if (missing.length > 0) {
      throw new CharacterRigCompilerError(
        "CHARACTER_RIG_PARTS_INCOMPLETE",
        missing,
      );
    }
    const invalidGeometry = [...approvedParts.entries()]
      .filter(([, attempt]) =>
        !isValidPartGeometry(attempt, input.width, input.height),
      )
      .map(([key]) => key);
    if (invalidGeometry.length > 0) {
      throw new CharacterRigCompilerError(
        "CHARACTER_RIG_PART_GEOMETRY_INVALID",
        invalidGeometry,
      );
    }
    const sourceFingerprint = requestFingerprint(
      "character-rig-sources",
      [...approvedParts.entries()]
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, attempt]) => ({
          key,
          artifactSha256: attempt.outputArtifact!.sha256,
        })),
    );
    const requestHash = requestFingerprint("character-rig-compilation", {
      bibleId: bible.id,
      width: input.width,
      height: input.height,
      sourceFingerprint,
    });
    const operationKey = `rig-compile:${input.idempotencyKey}`;
    const latest = await this.repository.findLatestRigVersion(
      input.projectId,
      bible.id,
    );
    const matching =
      latest?.sourceFingerprint === sourceFingerprint &&
      latest.canvas?.width === input.width &&
      latest.canvas.height === input.height;
    const rig = matching && latest
      ? latest
      : createRigVersion({
          projectId: input.projectId,
          bibleId: bible.id,
          version: (latest?.version ?? 0) + 1,
          approvedParts,
          sourceFingerprint,
          width: input.width,
          height: input.height,
          now: input.requestedAt,
        });
    let persistedRig = rig;
    let replayed = matching;
    if (!matching && !(await this.repository.saveRigVersion(rig))) {
      const raced = await this.repository.findLatestRigVersion(
        input.projectId,
        bible.id,
      );
      if (
        raced?.sourceFingerprint !== sourceFingerprint ||
        raced.canvas?.width !== input.width ||
        raced.canvas.height !== input.height
      ) {
        throw new CharacterRigCompilerError("CHARACTER_RIG_VERSION_CONFLICT");
      }
      persistedRig = raced;
      replayed = true;
    }
    const job = await this.#jobs.enqueue({
      projectId: input.projectId,
      type: "compile-rig",
      operationKey,
      requestHash,
      payload: {
        rigVersionId: persistedRig.id,
        width: input.width,
        height: input.height,
      },
      now: input.requestedAt,
      maxAttempts: 2,
    });
    return { rig: persistedRig, job, replayed };
  }
}

export class CharacterRigCompilerError extends Error {
  constructor(
    readonly code: string,
    readonly missingParts: string[] = [],
  ) {
    super(code);
  }
}

function indexApprovedParts(attempts: CharacterGenerationAttempt[]) {
  const result = new Map<string, CharacterGenerationAttempt>();
  for (const attempt of attempts) {
    if (
      attempt.status !== "approved" ||
      attempt.target.kind !== "part" ||
      !attempt.outputArtifact
    ) {
      continue;
    }
    const key = partKey(attempt.target.view, attempt.target.partName);
    if (!result.has(key)) result.set(key, attempt);
  }
  return result;
}

function requiredPartKeys(): string[] {
  return characterCanonicalViews.flatMap((view) =>
    [
      ...characterRequiredHeadParts,
      ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
    ].map((part) => partKey(view, part)),
  );
}

function partKey(view: CharacterCanonicalView, part: string): string {
  return `${view}:${part}`;
}

function createRigVersion(input: {
  projectId: string;
  bibleId: string;
  version: number;
  approvedParts: ReadonlyMap<string, CharacterGenerationAttempt>;
  sourceFingerprint: string;
  width: number;
  height: number;
  now: string;
}): CharacterRigVersion {
  const rootId = crypto.randomUUID();
  const nodes: CharacterRigNode[] = [
    groupNode(rootId, null, "+Character", null, "character-root", 0),
  ];
  for (const [viewIndex, view] of characterCanonicalViews.entries()) {
    const viewId = crypto.randomUUID();
    nodes.push(
      groupNode(
        viewId,
        rootId,
        `+${titleCase(view)}`,
        view,
        "view",
        viewIndex,
      ),
    );
    const parts = [
      ...characterRequiredHeadParts,
      ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
    ];
    for (const [partIndex, part] of parts.entries()) {
      const attempt = input.approvedParts.get(partKey(view, part));
      if (!attempt?.outputArtifact) {
        throw new CharacterRigCompilerError("CHARACTER_RIG_PARTS_INCOMPLETE", [
          partKey(view, part),
        ]);
      }
      nodes.push({
        id: crypto.randomUUID(),
        parentId: viewId,
        kind: "raster",
        name: `+${titleCase(part)}`,
        canonicalView: view,
        semanticPart: part,
        sourceGenerationAttemptId: attempt.id,
        artifact: attempt.outputArtifact,
        bounds: structuredClone(attempt.outputGeometry!.bounds),
        visible: view === "frontal",
        locked: false,
        opacity: 1,
        zIndex: partIndex,
      });
    }
  }
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId: input.projectId,
    bibleId: input.bibleId,
    version: input.version,
    status: "draft",
    sourceFingerprint: input.sourceFingerprint,
    canvas: { width: input.width, height: input.height },
    nodes,
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function isValidPartGeometry(
  attempt: CharacterGenerationAttempt,
  width: number,
  height: number,
): boolean {
  const geometry = attempt.outputGeometry;
  if (
    !geometry ||
    geometry.canvas.width !== width ||
    geometry.canvas.height !== height
  ) {
    return false;
  }
  const bounds = geometry.bounds;
  return (
    Number.isSafeInteger(bounds.x) &&
    Number.isSafeInteger(bounds.y) &&
    Number.isSafeInteger(bounds.width) &&
    Number.isSafeInteger(bounds.height) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= width &&
    bounds.y + bounds.height <= height
  );
}

function groupNode(
  id: string,
  parentId: string | null,
  name: `+${string}`,
  canonicalView: CharacterCanonicalView | null,
  semanticPart: string,
  zIndex: number,
): CharacterRigNode {
  return {
    id,
    parentId,
    kind: "group",
    name,
    canonicalView,
    semanticPart,
    sourceGenerationAttemptId: null,
    artifact: null,
    bounds: null,
    visible: canonicalView === null || canonicalView === "frontal",
    locked: false,
    opacity: 1,
    zIndex,
  };
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
