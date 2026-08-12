import type { Pool } from "pg";
import type {
  DerivedAssetCategory,
  DerivedAssetRegistry,
} from "../../storage/derived-asset-registry.js";

export class PostgresDerivedAssetRegistry implements DerivedAssetRegistry {
  constructor(private readonly pool: Pool) {}

  async register(
    projectId: string,
    objectKey: string,
    category: DerivedAssetCategory,
  ): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO derived_asset_registry (
         object_key, project_id, owner_user_id, category,
         registered_at, updated_at, purged_at
       )
       SELECT $2, project.id, project.owner_user_id, $3, now(), now(), NULL
       FROM projects project
       WHERE project.id = $1
       ON CONFLICT (object_key) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         owner_user_id = EXCLUDED.owner_user_id,
         category = EXCLUDED.category,
         updated_at = now(),
         purged_at = NULL`,
      [projectId, objectKey, category],
    );
    if (result.rowCount !== 1) {
      throw new Error("Derived asset project does not exist.");
    }
  }
}
