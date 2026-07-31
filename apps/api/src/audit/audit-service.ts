import type { AuditEvent } from "@motionprep/contracts";
import type { AuditRepository } from "./audit-repository.js";

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent> {
    const event: AuditEvent = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: this.now().toISOString(),
    };
    await this.repository.append(event);
    return event;
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    return this.repository.list(limit);
  }
}

