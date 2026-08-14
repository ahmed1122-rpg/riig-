import type {
  CharacterBible,
  CharacterCanonicalView,
  CharacterGenerationAttempt,
  CharacterGenerationTarget,
  CharacterGenerationReview,
  CharacterIdentityModelVersion,
  CharacterJob,
  CharacterReferenceAsset,
  CharacterReferenceRights,
  CharacterReferenceRole,
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { API_ORIGIN, request } from "./transport";

export interface CharacterRigStudioState {
  bible: CharacterBible | null;
  references: CharacterReferenceAsset[];
  identityModel: CharacterIdentityModelVersion | null;
  generations: CharacterGenerationAttempt[];
  rig: CharacterRigVersion | null;
  jobs: CharacterJob[];
}

export function bootstrapCharacterIdentity(
  projectId: string,
  bibleId: string,
): Promise<{
  modelVersion: CharacterIdentityModelVersion;
  job: CharacterJob;
}> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/identity-model`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ bibleId }),
    },
  );
}

export function queueCharacterGeneration(
  projectId: string,
  input: {
    bibleId: string;
    identityModelVersionId: string;
    target: CharacterGenerationTarget;
    angleDegrees: number;
    seed: number;
    canvas: { width: number; height: number };
    poseReferenceId?: string | null;
    depthReferenceId?: string | null;
    maskReferenceId?: string | null;
  },
): Promise<{
  attempt: CharacterGenerationAttempt;
  job: CharacterJob;
  replayed: boolean;
}> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/generations`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        bibleId: input.bibleId,
        identityModelVersionId: input.identityModelVersionId,
        target: input.target,
        controls: {
          seed: input.seed,
          canvas: input.canvas,
          poseReferenceId: input.poseReferenceId ?? null,
          depthReferenceId: input.depthReferenceId ?? null,
          maskReferenceId: input.maskReferenceId ?? null,
          parameters: { angleDegrees: input.angleDegrees },
        },
      }),
    },
  );
}

export function compileCharacterRig(
  projectId: string,
  input: { bibleId: string; width: number; height: number },
): Promise<{ rig: CharacterRigVersion; job: CharacterJob; replayed: boolean }> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/compile`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function reviewCharacterGeneration(
  projectId: string,
  generationAttemptId: string,
  input: {
    decision: CharacterGenerationReview["decision"];
    reason: string;
  },
): Promise<{
  attempt: CharacterGenerationAttempt;
  review: CharacterGenerationReview;
  replayed: boolean;
}> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/generations/${encodeURIComponent(generationAttemptId)}/reviews`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function characterGenerationArtifactUrl(
  projectId: string,
  generationAttemptId: string,
): string {
  return `${API_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/character-rig/generations/${encodeURIComponent(generationAttemptId)}/artifact`;
}

export function characterRigArtifactUrl(
  projectId: string,
  rigVersionId: string,
  artifactType: "psd" | "manifest",
): string {
  return `${API_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/character-rig/rigs/${encodeURIComponent(rigVersionId)}/artifacts/${artifactType}`;
}

export function reviewCharacterRig(
  projectId: string,
  rigVersionId: string,
  input: { decision: CharacterRigReview["decision"]; reason: string },
): Promise<{
  rig: CharacterRigVersion;
  review: CharacterRigReview;
  replayed: boolean;
}> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/rigs/${encodeURIComponent(rigVersionId)}/reviews`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function getCharacterRigStudio(
  projectId: string,
  signal?: AbortSignal,
): Promise<CharacterRigStudioState> {
  return request<CharacterRigStudioState>(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig`,
    { signal },
  );
}

export function saveCharacterBibleDraft(
  projectId: string,
  input: Omit<
    CharacterBible,
    | "schemaVersion"
    | "id"
    | "projectId"
    | "version"
    | "revision"
    | "status"
    | "createdByUserId"
    | "approvedByUserId"
    | "approvedAt"
    | "createdAt"
    | "updatedAt"
  > & {
    bibleId: string | null;
    expectedRevision: number | null;
  },
): Promise<CharacterBible> {
  return request<CharacterBible>(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/bible`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function approveCharacterBible(
  projectId: string,
  bibleId: string,
  expectedRevision: number,
): Promise<CharacterBible> {
  return request<CharacterBible>(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/bible/approve`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ bibleId, expectedRevision }),
    },
  );
}

export function addCurrentSourceCharacterReference(
  projectId: string,
  input: {
    bibleId: string;
    sourceVersionId: string;
    role: CharacterReferenceRole;
    canonicalView: CharacterCanonicalView | null;
    rightsClassification: CharacterReferenceRights;
  },
): Promise<CharacterReferenceAsset> {
  return request<CharacterReferenceAsset>(
    `/v1/projects/${encodeURIComponent(projectId)}/character-rig/references/current-source`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}
