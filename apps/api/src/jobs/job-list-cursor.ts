export interface JobListCursor {
  updatedAt: string;
  id: string;
}

export function isBeforeJobCursor(
  candidate: Pick<JobListCursor, "updatedAt" | "id">,
  cursor: JobListCursor,
  activityIdPrefix = "",
): boolean {
  const activityId = `${activityIdPrefix}${candidate.id}`;
  return (
    candidate.updatedAt < cursor.updatedAt ||
    (candidate.updatedAt === cursor.updatedAt && activityId < cursor.id)
  );
}

export function compareJobsByUpdatedAt(
  left: Pick<JobListCursor, "updatedAt" | "id">,
  right: Pick<JobListCursor, "updatedAt" | "id">,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

export function boundedJobListLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), 200));
}
