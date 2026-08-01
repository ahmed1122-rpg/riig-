import { Pool, type PoolConfig } from "pg";

export interface DatabaseHandle {
  pool: Pool;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseRuntimeOptions {
  applicationName?: string;
  onError?: (error: Error) => void;
}

export function createDatabase(
  connectionString: string,
  maxConnections: number,
  runtimeOptions: DatabaseRuntimeOptions = {},
): DatabaseHandle {
  const options: PoolConfig = {
    connectionString,
    max: maxConnections,
    ...(runtimeOptions.applicationName
      ? { application_name: runtimeOptions.applicationName }
      : {}),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  };
  const pool = new Pool(options);
  pool.on("error", (error) => {
    if (runtimeOptions.onError) {
      runtimeOptions.onError(error);
      return;
    }
    const errorCode =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "DATABASE_POOL_ERROR";
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        service: runtimeOptions.applicationName ?? "motionprep-database",
        message: "database.pool_error",
        context: { error_code: errorCode, error_name: error.name },
      })}\n`,
    );
  });

  return {
    pool,
    async ready() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
