import { Pool } from "pg";

const workerType = process.argv[2];
if (!["media", "document", "export"].includes(workerType)) {
  throw new Error("Usage: node scripts/check-worker-health.mjs <media|document|export>");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
