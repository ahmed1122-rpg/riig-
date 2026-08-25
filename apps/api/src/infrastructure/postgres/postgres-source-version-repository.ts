import type {
  MalwareScanVerdict,
  SourceType,
  SourceVersionStatus,
  SourceVersionSummary,
} from "@motionprep/contracts";
import type { Pool, PoolClient } from "pg";
import type {
  CreateSourceVersionInput,
  SourceVersionRepository,
} from "../../sources/source-version-repository.js";
import { toIso } from "./database.js";

interface SourceVersionRow {
  id: string;
  project_id: string;
  upload_id: string;
  version_number: number;
  filename: string;
  content_type: SourceType;
  size_bytes: number;
  status: SourceVersionStatus;
  sha256: string | null;
  malware_scan_verdict: MalwareScanVerdict;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresSourceVersionRepository
  implements SourceVersionRepository
{
  constructor(private readonly pool: Pool) {}

  async create(
    input: CreateSourceVersionInput,
  ): Promise<SourceVersionSummary> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [input.projectId],
      );
      const versionNumber = await nextVersionNumber(client, input.projectId);
      const result = await client.query<SourceVersionRow>(
        `
          INSERT INTO source_versions (
            id, project_id, upload_id, version_number, filename, content_type,
            size_bytes, status, sha256, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploading', NULL, now(), now())
          RETURNING ${sourceVersionColumns}
        `,
        [
          crypto.randomUUID(),
          input.projectId,
          input.uploadId,
          versionNumber,
          input.filename,
          input.contentType,
          input.sizeBytes,
        ],
      );
      await client.query("COMMIT");
      return mapSourceVersion(requiredRow(result.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<SourceVersionSummary | null> {
    const result = await this.pool.query<SourceVersionRow>(
      `SELECT ${sourceVersionColumns} FROM source_versions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapSourceVersion(result.rows[0]) : null;
  }

  async listByProject(projectId: string): Promise<SourceVersionSummary[]> {
    const result = await this.pool.query<SourceVersionRow>(
      `
        SELECT ${sourceVersionColumns}
        FROM source_versions
        WHERE project_id = $1
        ORDER BY version_number DESC
      `,
      [projectId],
    );
    return result.rows.map(mapSourceVersion);
  }

  async update(
    id: string,
    changes: {
      status?: SourceVersionStatus;
      sha256?: string | null;
      malwareScanVerdict?: MalwareScanVerdict;
    },
  ): Promise<SourceVersionSummary | null> {
    const result = await this.pool.query<SourceVersionRow>(
      `
        UPDATE source_versions
        SET
          status = COALESCE($2, status),
          sha256 = CASE WHEN $3::boolean THEN $4 ELSE sha256 END,
          malware_scan_verdict = COALESCE($5, malware_scan_verdict),
          updated_at = now()
        WHERE id = $1
        RETURNING ${sourceVersionColumns}
      `,
      [
        id,
        changes.status ?? null,
        Object.prototype.hasOwnProperty.call(changes, "sha256"),
        changes.sha256 ?? null,
        changes.malwareScanVerdict ?? null,
      ],
    );
    return result.rows[0] ? mapSourceVersion(result.rows[0]) : null;
  }
}

async function nextVersionNumber(
  client: PoolClient,
  projectId: string,
): Promise<number> {
  const result = await client.query<{ next_version: number }>(
    `
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM source_versions
      WHERE project_id = $1
    `,
    [projectId],
  );
  return requiredRow(result.rows[0]).next_version;
}

const sourceVersionColumns = `
  id, project_id, upload_id, version_number, filename, content_type, size_bytes,
  status, sha256, malware_scan_verdict, created_at, updated_at
`;

function mapSourceVersion(row: SourceVersionRow): SourceVersionSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    uploadId: row.upload_id,
    versionNumber: row.version_number,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    sha256: row.sha256,
    malwareScanVerdict: row.malware_scan_verdict,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL did not return the source version.");
  return row;
}
