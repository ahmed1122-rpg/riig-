import { createHash } from "node:crypto";
import type fastifyRateLimit from "@fastify/rate-limit";

interface RedisRateLimitCommands {
  sendCommand(arguments_: string[]): Promise<unknown>;
}

interface RateLimitStoreOptions {
  continueExceeding?: boolean;
  exponentialBackoff?: boolean;
  routeInfo?: { method?: string | string[]; url?: string };
}

type RateLimitResult = { current: number; ttl: number };
type RateLimitCallback = (
  error: Error | null,
  result?: RateLimitResult,
) => void;

export interface RateLimitStore extends fastifyRateLimit.FastifyRateLimitStore {
  read(
    key: string,
    callback: RateLimitCallback,
    timeWindow: number,
    max: number,
  ): void;
}

export type RateLimitStoreConstructor =
  fastifyRateLimit.FastifyRateLimitStoreCtor;

export function createRedisRateLimitStore(
  client: RedisRateLimitCommands,
): RateLimitStoreConstructor {
  const redisClient = client;
  return class RedisRateLimitStore implements RateLimitStore {
    private readonly prefix: string;

    constructor(
      options: fastifyRateLimit.FastifyRateLimitOptions,
      prefix = "motionprep:rate-limit:global:",
    ) {
      this.options = options as RateLimitStoreOptions;
      this.prefix = prefix;
    }

    private readonly options: RateLimitStoreOptions;

    incr(
      key: string,
      callback: RateLimitCallback,
      timeWindow: number,
      max: number,
    ): void {
      this.execute(
        incrementScript,
        key,
        [
          String(timeWindow),
          String(max),
          String(Boolean(this.options.continueExceeding)),
          String(Boolean(this.options.exponentialBackoff)),
        ],
        callback,
      );
    }

    read(
      key: string,
      callback: RateLimitCallback,
      _timeWindow: number,
      _max: number,
    ): void {
      this.execute(readScript, key, [], callback);
    }

    child(
      routeOptions: Parameters<
        fastifyRateLimit.FastifyRateLimitStore["child"]
      >[0],
    ): RateLimitStore {
      const options = routeOptions as typeof routeOptions &
        RateLimitStoreOptions & {
          routeInfo?: { method?: string | string[]; url?: string };
        };
      const routeKey = JSON.stringify({
        method: options.routeInfo?.method ?? "",
        url: options.routeInfo?.url ?? "",
      });
      return new RedisRateLimitStore(
        options,
        `motionprep:rate-limit:route:${digest(routeKey)}:`,
      );
    }

    private execute(
      script: string,
      key: string,
      arguments_: string[],
      callback: RateLimitCallback,
    ): void {
      void redisClient
        .sendCommand([
          "EVAL",
          script,
          "1",
          `${this.prefix}${digest(key)}`,
          ...arguments_,
        ])
        .then((value: unknown) => callback(null, parseResult(value)))
        .catch((error: unknown) =>
          callback(
            error instanceof Error
              ? error
              : new Error("Redis rate-limit command failed."),
          ),
        );
    }
  };
}

function parseResult(value: unknown): RateLimitResult {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("Redis returned an invalid rate-limit result.");
  }
  const current = Number(value[0]);
  const ttl = Number(value[1]);
  if (!Number.isFinite(current) || !Number.isFinite(ttl)) {
    throw new Error("Redis returned a non-numeric rate-limit result.");
  }
  return { current, ttl: Math.max(0, ttl) };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const incrementScript = `
  local current = redis.call('INCR', KEYS[1])
  local time_window = tonumber(ARGV[1])
  local max = tonumber(ARGV[2])
  local continue_exceeding = ARGV[3] == 'true'
  local exponential_backoff = ARGV[4] == 'true'
  local max_safe_integer = (2^53) - 1

  if current == 1 or (continue_exceeding and current > max) then
    redis.call('PEXPIRE', KEYS[1], time_window)
  elseif exponential_backoff and current > max then
    local exponent = current - max - 1
    time_window = math.min(time_window * (2 ^ exponent), max_safe_integer)
    redis.call('PEXPIRE', KEYS[1], time_window)
  else
    time_window = redis.call('PTTL', KEYS[1])
  end
  return {current, time_window}
`;

const readScript = `
  local current = redis.call('GET', KEYS[1])
  if not current then return {0, 0} end
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {tonumber(current), ttl}
`;
