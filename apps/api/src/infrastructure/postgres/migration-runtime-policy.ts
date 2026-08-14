import type { PoolClient } from "pg";

const DEFAULT_ADVISORY_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 60 * 60_000;
const ADVISORY_LOCK_POLL_INTERVAL_MS = 250;

export interface MigrationRuntimePolicy {
  advisoryLockTimeoutMs: number;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
}

export function loadMigrationDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const production = environment.NODE_ENV === "production";
  const migrationUrl = environment.MIGRATION_DATABASE_URL?.trim();
  const runtimeUrl = environment.DATABASE_URL?.trim();
  const selected = migrationUrl || (!production ? runtimeUrl : undefined);
  if (!selected) {
    throw new Error(
      production
        ? "MIGRATION_DATABASE_URL is required for production migrations."
        : "MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations.",
    );
  }

  const parsed = parsePostgresUrl(selected, "MIGRATION_DATABASE_URL");
  if (production) {
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    if (!["require", "verify-ca", "verify-full"].includes(sslMode ?? "")) {
      throw new Error("Production MIGRATION_DATABASE_URL must explicitly require TLS.");
    }
    if (runtimeUrl) {
      const runtime = parsePostgresUrl(runtimeUrl, "DATABASE_URL");
      if (runtime.username === parsed.username) {
        throw new Error(
          "Production migrations must use a database role separate from DATABASE_URL.",
        );
      }
    }
  }
  return selected;
}

interface AdvisoryLockRuntime {
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
}

export function loadMigrationRuntimePolicy(
  environment: NodeJS.ProcessEnv = process.env,
): MigrationRuntimePolicy {
  return {
    advisoryLockTimeoutMs: readInteger(
      environment,
      "MIGRATION_ADVISORY_LOCK_TIMEOUT_MS",
      DEFAULT_ADVISORY_LOCK_TIMEOUT_MS,
      1_000,
      10 * 60_000,
    ),
    lockTimeoutMs: readInteger(
      environment,
      "MIGRATION_LOCK_TIMEOUT_MS",
      DEFAULT_LOCK_TIMEOUT_MS,
      1_000,
      10 * 60_000,
    ),
    statementTimeoutMs: readInteger(
      environment,
      "MIGRATION_STATEMENT_TIMEOUT_MS",
      DEFAULT_STATEMENT_TIMEOUT_MS,
      0,
      24 * 60 * 60_000,
    ),
  };
}

export async function acquireMigrationAdvisoryLock(
  client: Pick<PoolClient, "query">,
  timeoutMs: number,
  runtime: AdvisoryLockRuntime = {
    now: Date.now,
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<void> {
  const startedAt = runtime.now();
  for (;;) {
    const result = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock(
         hashtext('motionprep_schema_migrations')
       ) AS acquired`,
    );
    if (result.rows[0]?.acquired) return;
    const elapsedMs = runtime.now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the schema migration lock. ` +
          "Another migration runner may still be active.",
      );
    }
    await runtime.wait(
      Math.min(ADVISORY_LOCK_POLL_INTERVAL_MS, timeoutMs - elapsedMs),
    );
  }
}

export async function applyMigrationTimeouts(
  client: Pick<PoolClient, "query">,
  policy: Pick<MigrationRuntimePolicy, "lockTimeoutMs" | "statementTimeoutMs">,
  local: boolean,
): Promise<void> {
  await client.query("SELECT set_config('lock_timeout', $1, $2)", [
    `${policy.lockTimeoutMs}ms`,
    local,
  ]);
  await client.query("SELECT set_config('statement_timeout', $1, $2)", [
    policy.statementTimeoutMs === 0 ? "0" : `${policy.statementTimeoutMs}ms`,
    local,
  ]);
}

export async function releaseMigrationAdvisoryLock(
  client: Pick<PoolClient, "query">,
  acquired: boolean,
): Promise<boolean> {
  if (!acquired) return false;
  await client.query(
    "SELECT pg_advisory_unlock(hashtext('motionprep_schema_migrations'))",
  );
  return true;
}

function readInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/u.test(raw)) throw invalidSetting(name, minimum, maximum);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidSetting(name, minimum, maximum);
  }
  return value;
}

function invalidSetting(name: string, minimum: number, maximum: number): Error {
  return new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
}

function parsePostgresUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use postgresql: or postgres:.`);
  }
  if (!parsed.username) {
    throw new Error(`${name} must identify an explicit database role.`);
  }
  return parsed;
}
