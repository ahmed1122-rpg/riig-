import type { ObjectStorage } from "../storage/object-storage.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import type { CharacterJobResultCommitter } from "./character-job-result-committer.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export interface CharacterJobExecutionContext {
  jobs: CharacterJobRepository;
  characterRigs: CharacterRigRepository;
  resultCommitter: CharacterJobResultCommitter;
  storage: ObjectStorage;
  workerId: string;
  leaseMilliseconds: number;
  now?: () => Date;
  onArtifactCleanupError?: (error: unknown, objectKey: string) => void;
  signal?: AbortSignal;
}
