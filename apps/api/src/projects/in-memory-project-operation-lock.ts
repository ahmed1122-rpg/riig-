export class InMemoryProjectOperationLock {
  readonly #locks = new Map<string, Promise<void>>();

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.#locks.set(projectId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(projectId) === queued) this.#locks.delete(projectId);
    }
  }
}
