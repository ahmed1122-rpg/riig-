import type { PoolClient } from "pg";

export interface UploadProjectLockRow {
  current_source_version_id: string | null;
  status: string;
}

export async function lockUploadProject<
  Row extends UploadProjectLockRow = UploadProjectLockRow,
>(client: PoolClient, projectId: string): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT current_source_version_id, status
     FROM projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new Error("Upload project no longer exists.");
  return project;
}
