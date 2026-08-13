export class ApplicationDrainingError extends Error {
  readonly code = "APPLICATION_DRAINING";

  constructor() {
    super("The application is draining and no longer accepts new work.");
    this.name = "ApplicationDrainingError";
  }
}

export class OperationalReadiness {
  private draining = false;

  constructor(
    private readonly dependencies: Readonly<
      Record<string, () => Promise<void>>
    >,
  ) {}

  beginDrain(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  async assertReady(): Promise<void> {
    this.assertAcceptingTraffic();
    await Promise.all(
      Object.values(this.dependencies).map((check) => check()),
    );
    this.assertAcceptingTraffic();
  }

  private assertAcceptingTraffic(): void {
    if (this.draining) throw new ApplicationDrainingError();
  }
}
