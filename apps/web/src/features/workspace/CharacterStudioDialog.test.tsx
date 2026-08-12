/** @vitest-environment jsdom */

import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
  type CharacterBible,
  type CharacterGenerationAttempt,
  type CharacterIdentityModelVersion,
  type CharacterJob,
  type CharacterReferenceAsset,
} from "@motionprep/contracts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compileCharacterRig,
  getCharacterRigStudio,
  queueCharacterGeneration,
  reviewCharacterGeneration,
  saveCharacterBibleDraft,
} from "../../lib/api/character-rig-client";
import { CharacterStudioDialog } from "./CharacterStudioDialog";

vi.mock("../../lib/api/character-rig-client", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/api/character-rig-client")
  >("../../lib/api/character-rig-client");
  return {
    ...actual,
    addCurrentSourceCharacterReference: vi.fn(),
    approveCharacterBible: vi.fn(),
    bootstrapCharacterIdentity: vi.fn(),
    compileCharacterRig: vi.fn(),
    getCharacterRigStudio: vi.fn(),
    queueCharacterGeneration: vi.fn(),
    reviewCharacterGeneration: vi.fn(),
    saveCharacterBibleDraft: vi.fn(),
  };
});

const timestamp = "2026-08-12T12:00:00.000Z";

const bible: CharacterBible = {
  schemaVersion: "1.0",
  id: "bible-1",
  projectId: "project-1",
  version: 1,
  revision: 3,
  status: "approved",
  displayName: "Hero",
  identityDescription: "A stable visual identity with a distinctive silhouette.",
  negativeConstraints: ["Do not change the eye color"],
  distinguishingFeatures: ["Angular blue glasses"],
  proportions: {
    headToBodyHeightRatio: 0.2,
    shoulderToBodyHeightRatio: 0.25,
    eyeSpacingToFaceWidthRatio: 0.22,
    notes: [],
  },
  palette: [
    { id: "palette-1", label: "Outline", role: "outline", color: "#111827" },
  ],
  materials: [],
  createdByUserId: "user-1",
  approvedByUserId: "user-1",
  approvedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const model: CharacterIdentityModelVersion = {
  id: "model-1",
  projectId: "project-1",
  bibleId: bible.id,
  version: 1,
  status: "ready",
  providerKey: "private-provider",
  providerModelReference: "provider-model-1",
  baseModelReference: "base-model-1",
  datasetFingerprint: "a".repeat(64),
  trainingConfiguration: {},
  failureCode: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const job: CharacterJob = {
  id: "job-1",
  projectId: "project-1",
  type: "generate-view",
  status: "queued",
  operationKey: "operation-1",
  requestHash: "b".repeat(64),
  payload: {},
  attempt: 0,
  maxAttempts: 3,
  nextAttemptAt: timestamp,
  leaseOwner: null,
  leaseExpiresAt: null,
  errorCode: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const artifact = {
  objectKey: "character/attempt.png",
  contentType: "image/png" as const,
  sizeBytes: 100,
  sha256: "c".repeat(64),
  createdAt: timestamp,
  retentionExpiresAt: null,
};

function generation(
  id: string,
  target: CharacterGenerationAttempt["target"],
  status: CharacterGenerationAttempt["status"] = "approved",
): CharacterGenerationAttempt {
  return {
    id,
    projectId: "project-1",
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target,
    status,
    controls: {
      seed: 1,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: {},
    },
    requestHash: "d".repeat(64),
    idempotencyKey: `key-${id}`,
    outputArtifact: artifact,
    qualityReport: null,
    failureCode: null,
    createdByUserId: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function renderStudio(
  overrides: Partial<React.ComponentProps<typeof CharacterStudioDialog>> = {},
) {
  return render(
    <CharacterStudioDialog
      projectId="project-1"
      sourceVersionId="source-1"
      canvasSize={{ width: 1200, height: 1600 }}
      onClose={vi.fn()}
      onNotify={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.mocked(getCharacterRigStudio).mockResolvedValue({
    bible: null,
    references: [],
    identityModel: null,
    generations: [],
    rig: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CharacterStudioDialog", () => {
  it("aborts its state request when the dialog unmounts", () => {
    let observedSignal: AbortSignal | undefined;
    vi.mocked(getCharacterRigStudio).mockImplementation((_projectId, signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });

    const view = renderStudio();
    expect(observedSignal?.aborted).toBe(false);
    view.unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("normalizes multiline Bible fields before saving a draft", async () => {
    vi.mocked(saveCharacterBibleDraft).mockResolvedValue({
      ...bible,
      status: "draft",
      approvedAt: null,
      approvedByUserId: null,
    });
    const onNotify = vi.fn();
    const view = renderStudio({ onNotify });

    await view.findByText("Character Bible");
    const form = view.container.querySelector(".character-bible-form")!;
    const name = form.querySelector<HTMLInputElement>('input:not([type="color"]):not([type="number"])')!;
    const textareas = form.querySelectorAll<HTMLTextAreaElement>("textarea");
    fireEvent.change(name, { target: { value: "Hero" } });
    fireEvent.change(textareas[0]!, {
      target: { value: "A stable visual identity with enough detail." },
    });
    fireEvent.change(textareas[1]!, {
      target: { value: "  blue glasses  \n\n scar above eye " },
    });
    fireEvent.change(textareas[2]!, {
      target: { value: " keep eye color \n keep silhouette " },
    });
    const saveButton = Array.from(form.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Draft"),
    )!;
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveCharacterBibleDraft).toHaveBeenCalledOnce());
    expect(saveCharacterBibleDraft).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        bibleId: null,
        expectedRevision: null,
        displayName: "Hero",
        distinguishingFeatures: ["blue glasses", "scar above eye"],
        negativeConstraints: ["keep eye color", "keep silhouette"],
      }),
    );
    expect(onNotify).toHaveBeenCalledOnce();
  });

  it("maps a turntable angle to the canonical view submitted to the queue", async () => {
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible,
      references: [],
      identityModel: model,
      generations: [],
      rig: null,
    });
    const queued = generation(
      "attempt-queued",
      { kind: "canonical-view", view: "right-profile" },
      "queued",
    );
    vi.mocked(queueCharacterGeneration).mockResolvedValue({
      attempt: queued,
      job,
      replayed: false,
    });
    const view = renderStudio();

    await view.findByText("Character Bible");
    fireEvent.click(view.container.querySelectorAll(".character-studio-steps button")[2]!);
    const stage = view.container.querySelector(".character-turntable-stage")!;
    fireEvent.change(stage.querySelector('input[type="range"]')!, {
      target: { value: "90" },
    });
    fireEvent.click(stage.querySelector(".button--primary")!);

    await waitFor(() => expect(queueCharacterGeneration).toHaveBeenCalledOnce());
    expect(queueCharacterGeneration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        bibleId: bible.id,
        identityModelVersionId: model.id,
        target: { kind: "canonical-view", view: "right-profile" },
        angleDegrees: 90,
      }),
    );
  });

  it("persists manual approval for the visible review candidate", async () => {
    const candidate = generation(
      "attempt-review",
      { kind: "canonical-view", view: "frontal" },
      "needs-review",
    );
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible,
      references: [],
      identityModel: model,
      generations: [candidate],
      rig: null,
    });
    vi.mocked(reviewCharacterGeneration).mockResolvedValue({
      attempt: { ...candidate, status: "approved" },
      review: {
        id: "review-1",
        projectId: "project-1",
        generationAttemptId: candidate.id,
        decision: "approved",
        reason: "Manual identity approval",
        reviewerUserId: "user-1",
        operationId: "operation-review",
        createdAt: timestamp,
      },
      replayed: false,
    });
    const view = renderStudio();

    await view.findByText("Character Bible");
    fireEvent.click(view.container.querySelectorAll(".character-studio-steps button")[3]!);
    const stage = view.container.querySelector(".character-comparison-stage")!;
    const reason = stage.querySelector("textarea")!;
    fireEvent.change(reason, { target: { value: "Manual identity approval" } });
    fireEvent.click(stage.querySelector(".button--primary")!);

    await waitFor(() => expect(reviewCharacterGeneration).toHaveBeenCalledWith(
      "project-1",
      candidate.id,
      { decision: "approved", reason: "Manual identity approval" },
    ));
  });

  it("queues compilation only after every required part is approved", async () => {
    const approvedParts = characterCanonicalViews.flatMap((view) =>
      characterRequiredHeadParts.map((partName) =>
        generation(`${view}-${partName}`, { kind: "part", view, partName }),
      ),
    );
    approvedParts.push(
      ...characterRequiredFrontalBodyParts.map((partName) =>
        generation(`frontal-${partName}`, {
          kind: "part",
          view: "frontal",
          partName,
        }),
      ),
    );
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible,
      references: [] as CharacterReferenceAsset[],
      identityModel: model,
      generations: approvedParts,
      rig: null,
    });
    vi.mocked(compileCharacterRig).mockResolvedValue({
      rig: {
        schemaVersion: "1.0",
        id: "rig-1",
        projectId: "project-1",
        bibleId: bible.id,
        version: 1,
        status: "draft",
        nodes: [],
        psdArtifact: null,
        manifestArtifact: null,
        approvedByUserId: null,
        approvedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      job: { ...job, type: "compile-rig" },
      replayed: false,
    });
    const view = renderStudio();

    await view.findByText("Character Bible");
    fireEvent.click(view.container.querySelectorAll(".character-studio-steps button")[4]!);
    const compileButton = view.container.querySelector<HTMLButtonElement>(
      ".character-rig-stage .button--primary",
    )!;
    expect(compileButton.disabled).toBe(false);
    fireEvent.click(compileButton);

    await waitFor(() => expect(compileCharacterRig).toHaveBeenCalledWith(
      "project-1",
      { bibleId: bible.id, width: 1200, height: 1600 },
    ));
  });
});
