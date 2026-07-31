interface AttemptState {
  failures: number;
  lockedUntil: number;
  expiresAt: number;
}

export interface LoginAttemptStore {
  isLocked(key: string): Promise<boolean>;
  recordFailure(key: string): Promise<boolean>;
  clear(key: string): Promise<void>;
}

export class InMemoryLoginAttemptStore implements LoginAttemptStore {
  readonly #attempts = new Map<string, AttemptState>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly maxFailures = 5,
    private readonly windowSeconds = 15 * 60,
    private readonly lockSeconds = 5 * 60,
  ) {}

  async isLocked(key: string): Promise<boolean> {
    const attempt = this.#attempts.get(key);
    if (!attempt) return false;
    const now = this.now().getTime();
    if (attempt.expiresAt <= now && attempt.lockedUntil <= now) {
      this.#attempts.delete(key);
      return false;
    }
    return attempt.lockedUntil > now;
  }

  async recordFailure(key: string): Promise<boolean> {
    const now = this.now().getTime();
    const current = this.#attempts.get(key);
    const failures =
      current && current.expiresAt > now ? current.failures + 1 : 1;
    const lockedUntil =
      failures >= this.maxFailures ? now + this.lockSeconds * 1000 : 0;
    this.#attempts.set(key, {
      failures,
      lockedUntil,
      expiresAt: now + this.windowSeconds * 1000,
    });
    return lockedUntil > now;
  }

  async clear(key: string): Promise<void> {
    this.#attempts.delete(key);
  }
}

