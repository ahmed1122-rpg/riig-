import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { LoginAttemptStore } from "../../auth/login-attempt-store.js";
import { createRedisRateLimitStore } from "./redis-rate-limit-store.js";

interface RedisCommands {
  exists(key: string): Promise<number>;
  sendCommand(arguments_: string[]): Promise<unknown>;
  del(keys: string[]): Promise<number>;
}

class RedisLoginAttemptStore implements LoginAttemptStore {
  constructor(
    private readonly client: RedisCommands,
    private readonly maxFailures = 5,
    private readonly windowSeconds = 15 * 60,
    private readonly lockSeconds = 5 * 60,
  ) {}

  async isLocked(key: string): Promise<boolean> {
    return (await this.client.exists(this.lockKey(key))) > 0;
  }

  async recordFailure(key: string): Promise<boolean> {
    const result = await this.client.sendCommand([
      "EVAL",
      failureScript,
      "2",
      this.failureKey(key),
      this.lockKey(key),
      String(this.maxFailures),
      String(this.windowSeconds),
      String(this.lockSeconds),
    ]);
    return Number(result) === 1;
  }

  async clear(key: string): Promise<void> {
    await this.client.del([this.failureKey(key), this.lockKey(key)]);
  }

  private failureKey(key: string): string {
    return `motionprep:auth:failures:${hashKey(key)}`;
  }

  private lockKey(key: string): string {
    return `motionprep:auth:lock:${hashKey(key)}`;
  }
}

export function createRedisSecurity(
  url: string,
  options: {
    maxFailures: number;
    windowSeconds: number;
    lockSeconds: number;
  },
) {
  const client = createClient({ url });
  return {
    loginAttempts: new RedisLoginAttemptStore(
      client,
      options.maxFailures,
      options.windowSeconds,
      options.lockSeconds,
    ),
    rateLimitStore: createRedisRateLimitStore(client),
    async ready() {
      if (!client.isOpen) await client.connect();
      await client.ping();
    },
    async close() {
      if (client.isOpen) await client.quit();
    },
  };
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const failureScript = `
  local failures = redis.call('INCR', KEYS[1])
  if failures == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  if failures >= tonumber(ARGV[1]) then
    redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
    redis.call('DEL', KEYS[1])
    return 1
  end
  return 0
`;
