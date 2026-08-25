import type {
  ObjectReadOptions,
  ObjectStorage,
  StoredObject,
  StoredObjectMetadata,
  StoredObjectStream,
  StoredObjectWriteStream,
} from "./object-storage.js";

type ObjectWriterType = "upload" | "export" | "character" | "derived";

export interface ObjectWriteScope {
  projectId: string;
  writerType: ObjectWriterType;
}

export interface ObjectWriteLease {
  id: string;
  projectId: string;
  objectKey: string;
}

export interface ObjectWriteLeaseCoordinator {
  acquire(
    scope: ObjectWriteScope,
    objectKey: string,
    acquiredAt: string,
    expiresAt: string,
  ): Promise<ObjectWriteLease>;
  renew(lease: ObjectWriteLease, renewedAt: string, expiresAt: string): Promise<boolean>;
  cooldown(lease: ObjectWriteLease, completedAt: string, expiresAt: string): Promise<boolean>;
}

const DEFAULT_WRITE_LEASE_MILLISECONDS = 15 * 60_000;
const DEFAULT_HEARTBEAT_MILLISECONDS = 60_000;
const DEFAULT_COOLDOWN_MILLISECONDS = 15 * 60_000;

export class ObjectWriteLeaseLostError extends Error {
  readonly code = "OBJECT_WRITE_LEASE_LOST";

  constructor(objectKey: string) {
    super(`The durable object-write lease was lost for ${objectKey}.`);
  }
}

/**
 * Fences every production object write against account tombstoning. A
 * successful write keeps a short durable cooldown lease so the database
 * publication immediately following `put` is covered by deletion draining.
 */
export class LeaseGuardedObjectStorage implements ObjectStorage {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly leases: ObjectWriteLeaseCoordinator,
    private readonly now: () => Date = () => new Date(),
    private readonly options: {
      writeLeaseMilliseconds?: number;
      heartbeatMilliseconds?: number;
      cooldownMilliseconds?: number;
    } = {},
  ) {}

  async put(object: StoredObject): Promise<StoredObjectMetadata> {
    return this.writeWithLease(object.key, () => this.storage.put(object));
  }

  async putStream(
    object: StoredObjectWriteStream,
  ): Promise<StoredObjectMetadata> {
    return this.writeWithLease(
      object.key,
      () => this.storage.putStream(object),
    );
  }

  private async writeWithLease(
    objectKey: string,
    write: () => Promise<StoredObjectMetadata>,
  ): Promise<StoredObjectMetadata> {
    let lease: ObjectWriteLease;
    try {
      lease = await this.acquire(objectKey);
    } catch (error) {
      await this.storage.purge([objectKey], []).catch(() => undefined);
      throw error;
    }
    const heartbeat = this.startHeartbeat(lease);
    let stored: StoredObjectMetadata;
    try {
      stored = await write();
    } catch (error) {
      await heartbeat.stop();
      await this.storage.purge([objectKey], []).catch(() => undefined);
      await this.enterCooldown(lease).catch(() => undefined);
      throw error;
    }

    await heartbeat.stop();
    if (heartbeat.lost() || !(await this.enterCooldown(lease))) {
      await this.storage.purge([objectKey], []);
      throw new ObjectWriteLeaseLostError(objectKey);
    }
    return stored;
  }

  async guardExternalWrite<T>(
    objectKey: string,
    write: () => Promise<T>,
  ): Promise<T> {
    let lease: ObjectWriteLease;
    try {
      lease = await this.acquire(objectKey);
    } catch (error) {
      await this.storage.purge([objectKey], []).catch(() => undefined);
      throw error;
    }
    const heartbeat = this.startHeartbeat(lease);
    try {
      const result = await write();
      await heartbeat.stop();
      if (heartbeat.lost() || !(await this.enterCooldown(lease))) {
        await this.storage.purge([objectKey], []);
        throw new ObjectWriteLeaseLostError(objectKey);
      }
      return result;
    } catch (error) {
      await heartbeat.stop();
      await this.storage.purge([objectKey], []).catch(() => undefined);
      await this.enterCooldown(lease).catch(() => undefined);
      throw error;
    }
  }

  list(prefix: string): Promise<string[]> {
    return this.storage.list(prefix);
  }

  purge(keys: readonly string[], prefixes: readonly string[]): Promise<void> {
    return this.storage.purge(keys, prefixes);
  }

  inspect(key: string): Promise<StoredObjectMetadata | null> {
    return this.storage.inspect(key);
  }

  getStream(
    key: string,
    options?: ObjectReadOptions,
  ): Promise<StoredObjectStream | null> {
    return this.storage.getStream(key, options);
  }

  get(key: string, options?: ObjectReadOptions): Promise<StoredObject | null> {
    return this.storage.get(key, options);
  }

  delete(key: string): Promise<void> {
    return this.storage.delete(key);
  }

  private enterCooldown(lease: ObjectWriteLease): Promise<boolean> {
    const completedAt = this.now();
    return this.leases.cooldown(
      lease,
      completedAt.toISOString(),
      new Date(
        completedAt.getTime() +
          (this.options.cooldownMilliseconds ?? DEFAULT_COOLDOWN_MILLISECONDS),
      ).toISOString(),
    );
  }

  private async acquire(objectKey: string): Promise<ObjectWriteLease> {
    const scope = objectWriteScope(objectKey);
    const acquiredAt = this.now();
    return this.leases.acquire(
      scope,
      objectKey,
      acquiredAt.toISOString(),
      new Date(
        acquiredAt.getTime() +
          (this.options.writeLeaseMilliseconds ?? DEFAULT_WRITE_LEASE_MILLISECONDS),
      ).toISOString(),
    );
  }

  private startHeartbeat(lease: ObjectWriteLease): {
    lost(): boolean;
    stop(): Promise<void>;
  } {
    const interval = this.options.heartbeatMilliseconds ?? DEFAULT_HEARTBEAT_MILLISECONDS;
    let stopped = false;
    let leaseLost = false;
    let pending: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (stopped || pending) return;
      const renewedAt = this.now();
      pending = this.leases
        .renew(
          lease,
          renewedAt.toISOString(),
          new Date(
            renewedAt.getTime() +
              (this.options.writeLeaseMilliseconds ?? DEFAULT_WRITE_LEASE_MILLISECONDS),
          ).toISOString(),
        )
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          pending = null;
        });
    }, interval);
    timer.unref();
    return {
      lost: () => leaseLost,
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await pending;
      },
    };
  }
}

export function guardExternalObjectWrite<T>(
  storage: ObjectStorage,
  objectKey: string,
  write: () => Promise<T>,
): Promise<T> {
  return storage instanceof LeaseGuardedObjectStorage
    ? storage.guardExternalWrite(objectKey, write)
    : write();
}

export function objectWriteScope(objectKey: string): ObjectWriteScope {
  const [namespace, encodedProjectId] = objectKey.split("/", 3);
  if (!namespace || !encodedProjectId) {
    throw new Error(`Object key ${objectKey} is outside a project write scope.`);
  }
  let projectId: string;
  try {
    projectId = decodeURIComponent(encodedProjectId);
  } catch {
    throw new Error(`Object key ${objectKey} has an invalid project scope.`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(projectId)) {
    throw new Error(`Object key ${objectKey} has an invalid project identifier.`);
  }
  const writerType: ObjectWriterType =
    namespace === "sources" || namespace === "quarantine"
      ? "upload"
      : namespace === "artifacts"
        ? "export"
        : namespace === "projects"
          ? "character"
          : namespace === "derived"
            ? "derived"
            : (() => {
                throw new Error(`Object key ${objectKey} uses an unsupported write scope.`);
              })();
  return { projectId, writerType };
}
