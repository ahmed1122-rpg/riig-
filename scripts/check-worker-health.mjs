import { Pool } from "pg";
import { pathToFileURL } from "node:url";

export function validateWorkerHealthDatabaseUrl(value, nodeEnvironment) {
  if (!value) return ["DATABASE_URL is required."];
  let url;
  try {
    url = new URL(value);
  } catch {
    return ["DATABASE_URL must be a valid URL."];
  }
  const violations = [];
  if (!["postgresql:", "postgres:"].includes(url.protocol)) {
    violations.push("DATABASE_URL must use postgresql: or postgres:.");
  }
  if (
    nodeEnvironment === "production" &&
    !["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode")?.toLowerCase() ?? "",
    )
  ) {
    violations.push("Production worker health checks require PostgreSQL TLS.");
  }
  return violations;
}

async function main() {
  const workerType = process.argv[2];
  if (!["media", "document", "export", "character"].includes(workerType)) {
    throw new Error("Usage: node scripts/check-worker-health.mjs <media|document|export|character>");
  }
  const databaseUrl = process.env.DATABASE_URL;
  const violations = validateWorkerHealthDatabaseUrl(
    databaseUrl,
    process.env.NODE_ENV,
  );
  if (violations.length > 0) throw new Error(violations.join(" "));

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 3_000,
  });
  try {
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM worker_heartbeats
         WHERE worker_type = $1
           AND last_seen_at > now() - interval '45 seconds'
       ) AS healthy`,
      [workerType],
    );
    if (result.rows[0]?.healthy !== true) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
