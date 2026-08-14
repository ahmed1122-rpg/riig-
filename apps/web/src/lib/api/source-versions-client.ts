import { request } from "./transport";
import type {
  SourceVersionRestoreEvent,
  SourceVersionRestoreResult,
  SourceVersionSummary,
} from "./models";

export function listSourceVersions(
  projectId: string,
  signal?: AbortSignal,
): Promise<SourceVersionSummary[]> {
  return request<SourceVersionSummary[]>(
    `/v1/projects/${encodeURIComponent(projectId)}/source-versions`,
    { signal },
  );
}

export function listSourceVersionRestores(
  projectId: string,
  signal?: AbortSignal,
): Promise<SourceVersionRestoreEvent[]> {
  return request<SourceVersionRestoreEvent[]>(
    `/v1/projects/${encodeURIComponent(projectId)}/source-version-restores`,
    { signal },
  );
}

export function restoreSourceVersion(
  projectId: string,
  versionId: string,
  input: {
    expectedCurrentSourceVersionId: string;
    reason: string;
    idempotencyKey?: string;
  },
  signal?: AbortSignal,
): Promise<SourceVersionRestoreResult> {
  return request<SourceVersionRestoreResult>(
    `/v1/projects/${encodeURIComponent(projectId)}/source-versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: "POST",
      signal,
      headers: {
        "x-idempotency-key":
          input.idempotencyKey ?? crypto.randomUUID(),
      },
      body: JSON.stringify({
        expectedCurrentSourceVersionId:
          input.expectedCurrentSourceVersionId,
        reason: input.reason,
      }),
    },
  );
}
