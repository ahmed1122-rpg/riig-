/**
 * Serializes in-memory upload transitions by a stable scope (normally the
 * project ID) while allowing unrelated projects to proceed independently.
 */
export class UploadOperationLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.#tails.set(scope, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(scope) === queued) this.#tails.delete(scope);
    }
  }
}
