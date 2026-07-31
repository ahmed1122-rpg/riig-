export interface WorkerDrainOptions<T> {
  timeoutMilliseconds: number;
  release: (item: T) => Promise<void>;
  onReleaseError?: (error: unknown, item: T) => void;
}

export class WorkerDrainCoordinator<T> {
  readonly #active = new Map<string, T>();
  readonly #options: WorkerDrainOptions<T>;
  readonly #completed: Promise<void>;
  #resolveCompleted!: () => void;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #shutdownRequested = false;
  #settled = false;

  constructor(options: WorkerDrainOptions<T>) {
    this.#options = options;
    this.#completed = new Promise((resolve) => {
      this.#resolveCompleted = resolve;
    });
  }

  async register(key: string, item: T): Promise<boolean> {
    if (this.#shutdownRequested) {
      await this.#release(item);
      return false;
    }
    this.#active.set(key, item);
    return true;
  }

  unregister(key: string): void {
    this.#active.delete(key);
    if (this.#shutdownRequested && this.#active.size === 0) {
      this.#finish();
    }
  }

  requestShutdown(): void {
    if (this.#shutdownRequested) return;
    this.#shutdownRequested = true;
    if (this.#active.size === 0) {
      this.#finish();
      return;
    }
    this.#timer = setTimeout(() => {
      void this.#releaseActive();
    }, this.#options.timeoutMilliseconds);
  }

  waitForRelease(): Promise<void> {
    return this.#completed;
  }

  get activeCount(): number {
    return this.#active.size;
  }

  async #releaseActive(): Promise<void> {
    await Promise.all(
      [...this.#active.values()].map((item) => this.#release(item)),
    );
    this.#finish();
  }

  async #release(item: T): Promise<void> {
    try {
      await this.#options.release(item);
    } catch (error) {
      this.#options.onReleaseError?.(error, item);
    }
  }

  #finish(): void {
    if (this.#settled) return;
    this.#settled = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#resolveCompleted();
  }
}
