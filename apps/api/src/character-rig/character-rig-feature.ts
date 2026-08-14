import type { FastifyInstance } from "fastify";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthService } from "../auth/auth-service.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import { CharacterBibleService } from "./character-bible-service.js";
import { CharacterGenerationService } from "./character-generation-service.js";
import { CharacterIdentityBootstrapService } from "./character-identity-bootstrap-service.js";
import {
  InMemoryCharacterJobRepository,
  type CharacterJobRepository,
} from "./character-job-repository.js";
import { CharacterReferenceService } from "./character-reference-service.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import { CharacterRigReviewService } from "./character-rig-review-service.js";
import {
  InMemoryCharacterRigRepository,
  type CharacterRigRepository,
} from "./character-rig-repository.js";
import { registerCharacterRigRoutes } from "./character-rig-routes.js";

interface CharacterRigFeatureOptions {
  projects: ProjectRepository;
  auth: AuthService;
  uploads: UploadRepository;
  storage: ObjectStorage;
  audit: AuditService;
  enabled: boolean;
  now?: () => Date;
  repositories?: {
    rigs?: CharacterRigRepository;
    jobs?: CharacterJobRepository;
  };
}

export async function registerCharacterRigFeature(
  app: FastifyInstance,
  options: CharacterRigFeatureOptions,
): Promise<void> {
  const rigs = options.repositories?.rigs ?? new InMemoryCharacterRigRepository();
  const jobs = options.repositories?.jobs ?? new InMemoryCharacterJobRepository();

  await registerCharacterRigRoutes(app, {
    projects: options.projects,
    auth: options.auth,
    characterRigs: rigs,
    characterJobs: jobs,
    bibleService: new CharacterBibleService(rigs),
    referenceService: new CharacterReferenceService(
      rigs,
      options.uploads,
      options.storage,
      options.now,
    ),
    identityService: new CharacterIdentityBootstrapService(rigs, jobs),
    generationService: new CharacterGenerationService(rigs, jobs),
    compilerService: new CharacterRigCompilerService(rigs, jobs),
    rigReviewService: new CharacterRigReviewService(rigs, options.storage),
    objectStorage: options.storage,
    audit: options.audit,
    enabled: options.enabled,
    providerKey: "private-http",
    baseModelReference: "identity-preserving-v1",
    ...(options.now ? { now: options.now } : {}),
  });
}
