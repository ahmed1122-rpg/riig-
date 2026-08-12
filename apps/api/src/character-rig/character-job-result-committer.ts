import type {
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
  CharacterRigVersion,
} from "@motionprep/contracts";
import type { CharacterJobRepository } from "./character-job-repository.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export type CharacterJobResult =
  | { kind: "identity-model"; model: CharacterIdentityModelVersion }
  | { kind: "generation"; attempt: CharacterGenerationAttempt }
  | { kind: "rig"; rig: CharacterRigVersion };

export interface CharacterJobResultCommitter {
  commit(
    jobId: string,
    workerId: string,
    completedAt: string,
    result: CharacterJobResult,
  ): Promise<boolean>;
}

export class InMemoryCharacterJobResultCommitter
  implements CharacterJobResultCommitter
{
  constructor(
    private readonly jobs: CharacterJobRepository,
    private readonly rigs: CharacterRigRepository,
  ) {}

  async commit(
    jobId: string,
    workerId: string,
    completedAt: string,
    result: CharacterJobResult,
  ): Promise<boolean> {
    const completed = await this.jobs.completeClaim(jobId, workerId, completedAt);
    if (!completed) return false;
    const saved =
      result.kind === "identity-model"
        ? await this.rigs.saveIdentityModelVersion(result.model)
        : result.kind === "generation"
          ? await this.rigs.saveGenerationAttempt(result.attempt)
          : await this.rigs.saveRigVersion(result.rig);
    if (!saved) {
      throw new Error("The claimed Character result could not be persisted.");
    }
    return true;
  }
}

