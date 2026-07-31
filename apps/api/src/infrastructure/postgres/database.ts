import { Pool, type PoolConfig } from "pg";

export interface DatabaseHandle {
  pool: Pool;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(
  connectionString: string,
  maxConnections: number,
): DatabaseHandle {
  const options: PoolConfig = {
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  };
  const pool = new Pool(options);

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

