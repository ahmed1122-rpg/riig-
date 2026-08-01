import type {
  CreateProjectInput,
  ProjectStatus,
  ProjectSummary,
} from "@motionprep/contracts";
import type { Pool } from "pg";
import type {
  ActiveProjectJob,
  ProjectRepository,
} from "../../projects/project-repository.js";
import {
  mapPostgresProject,
  type PostgresProjectRow,
} from "./postgres-project-mapper.js";

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    ownerUserId: string,
    input: CreateProjectInput,
  ): Promise<ProjectSummary> {
    const now = new Date().toISOString();
    const result = await this.pool.query<PostgresProjectRow>(
      `
        INSERT INTO projects (
          id, owner_user_id, name, kind, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'draft', $5, $5)
        RETURNING id, name, kind, status, current_source_version_id,
          NULL::integer AS current_source_version_number, created_at, updated_at
      `,
      [crypto.randomUUID(), ownerUserId, input.name, input.kind, now],
    );
    return mapPostgresProject(requiredRow(result.rows[0]));
  }

  async findOwnedById(
    ownerUserId: string,
    id: string,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        SELECT ${projectColumns}
        FROM projects AS project
        LEFT JOIN source_versions AS source
          ON source.id = project.current_source_version_id
        WHERE project.owner_user_id = $1 AND project.id = $2
      `,
      [ownerUserId, id],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        SELECT ${projectColumns}
        FROM projects AS project
        LEFT JOIN source_versions AS source
          ON source.id = project.current_source_version_id
        WHERE project.owner_user_id = $1
        ORDER BY project.updated_at DESC
      `,
      [ownerUserId],
    );
    return result.rows.map((row) => mapPostgresProject(row));
  }

  async updateStatus(
    id: string,
    status: ProjectStatus,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $2,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        )
        SELECT
          updated.id, updated.name, updated.kind, updated.status,
          updated.current_source_version_id,
          source.version_number AS current_source_version_number,
          updated.created_at, updated.updated_at
        FROM updated
        LEFT JOIN source_versions AS source
          ON source.id = updated.current_source_version_id
      `,
      [id, status],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async updateStatusForSource(
    id: string,
    sourceVersionId: string,
    status: ProjectStatus,
    activeJob: ActiveProjectJob | null,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $3,
              active_job_type = $4,
              active_job_id = $5,
              updated_at = now()
          WHERE id = $1
            AND current_source_version_id = $2
            AND (
              active_job_id IS NULL
              OR (active_job_type = $4 AND active_job_id = $5)
            )
          RETURNING *
        )
        SELECT
          updated.id, updated.name, updated.kind, updated.status,
          updated.current_source_version_id,
          source.version_number AS current_source_version_number,
          updated.created_at, updated.updated_at
        FROM updated
        LEFT JOIN source_versions AS source
          ON source.id = updated.current_source_version_id
      `,
      [
        id,
        sourceVersionId,
        status,
        activeJob?.type ?? null,
        activeJob?.id ?? null,
      ],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async finishJobStatus(
    id: string,
    sourceVersionId: string,
    activeJob: ActiveProjectJob,
    status: ProjectStatus,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET status = $5,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
            AND current_source_version_id = $2
            AND active_job_type = $3
            AND active_job_id = $4
          RETURNING *
        )
        SELECT
          updated.id, updated.name, updated.kind, updated.status,
          updated.current_source_version_id,
          source.version_number AS current_source_version_number,
          updated.created_at, updated.updated_at
        FROM updated
        LEFT JOIN source_versions AS source
          ON source.id = updated.current_source_version_id
      `,
      [id, sourceVersionId, activeJob.type, activeJob.id, status],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }

  async updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    _versionNumber: number,
  ): Promise<ProjectSummary | null> {
    const result = await this.pool.query<PostgresProjectRow>(
      `
        WITH updated AS (
          UPDATE projects
          SET current_source_version_id = $2,
              active_job_type = NULL,
              active_job_id = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        )
        SELECT
          updated.id, updated.name, updated.kind, updated.status,
          updated.current_source_version_id,
          source.version_number AS current_source_version_number,
          updated.created_at, updated.updated_at
        FROM updated
        LEFT JOIN source_versions AS source
          ON source.id = updated.current_source_version_id
      `,
      [id, sourceVersionId],
    );
    return result.rows[0] ? mapPostgresProject(result.rows[0]) : null;
  }
}

const projectColumns = `
  project.id, project.name, project.kind, project.status,
  project.current_source_version_id,
  source.version_number AS current_source_version_number,
  project.created_at, project.updated_at
`;

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new Error("PostgreSQL did not return the inserted project.");
  return row;
}
