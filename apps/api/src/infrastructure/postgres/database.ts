import { Pool, type PoolClient, type PoolConfig } from "pg";

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
  const reportError = (error: Error) => {
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
  };
  pool.on("error", reportError);

  // pg removes its idle-client error listener while a client is checked out.
  // A database restart can otherwise emit an unhandled Client "error" event
  // between connect() and release(), terminating a worker or API process.
  const checkedOutErrorListeners = new WeakMap<
    PoolClient,
    (error: Error) => void
  >();
  pool.on("acquire", (client) => {
    const listener = (error: Error) => reportError(error);
    checkedOutErrorListeners.set(client, listener);
    client.on("error", listener);
  });
  pool.on("release", (_error, client) => {
    removeCheckedOutErrorListener(checkedOutErrorListeners, client);
  });
  pool.on("remove", (client) => {
    removeCheckedOutErrorListener(checkedOutErrorListeners, client);
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

function removeCheckedOutErrorListener(
  listeners: WeakMap<PoolClient, (error: Error) => void>,
  client: PoolClient,
): void {
  const listener = listeners.get(client);
  if (!listener) return;
  client.off("error", listener);
  listeners.delete(client);
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function rollbackTransaction(
  client: Pick<PoolClient, "query">,
  transactionError: unknown,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [transactionError, rollbackError],
      "Database transaction failed and its rollback also failed.",
      { cause: rollbackError },
    );
  }
}
