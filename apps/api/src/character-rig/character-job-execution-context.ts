import type { ObjectStorage } from "../storage/object-storage.js";
import type { CharacterInferenceProvider } from "./character-inference-provider.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import type { CharacterJobResultCommitter } from "./character-job-result-committer.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import type { CharacterQualityThresholds } from "./character-quality-policy.js";

export interface CharacterJobExecutionContext {
  jobs: CharacterJobRepository;
  characterRigs: CharacterRigRepository;
  resultCommitter: CharacterJobResultCommitter;
  provider: CharacterInferenceProvider;
  storage: ObjectStorage;
  workerId: string;
  leaseMilliseconds: number;
  now?: () => Date;
  qualityThresholds?: CharacterQualityThresholds;
  onArtifactCleanupError?: (error: unknown, objectKey: string) => void;
  signal?: AbortSignal;
}
