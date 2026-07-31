import type { AuditEvent } from "@motionprep/contracts";

export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  list(limit: number): Promise<AuditEvent[]>;
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly #events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.#events.unshift(event);
  }

  async list(limit: number): Promise<AuditEvent[]> {
    return this.#events.slice(0, Math.max(1, Math.min(limit, 500)));
  }
}

