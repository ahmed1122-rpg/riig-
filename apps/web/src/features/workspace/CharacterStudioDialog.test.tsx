/** @vitest-environment jsdom */

import type {
  CharacterBible,
  CharacterReferenceAsset,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCurrentSourceCharacterReference,
  approveCharacterBible,
  compileCharacterRig,
  getCharacterRigStudio,
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
    compileCharacterRig: vi.fn(),
    getCharacterRigStudio: vi.fn(),
    saveCharacterBibleDraft: vi.fn(),
  };
});

const timestamp = "2026-08-28T12:00:00.000Z";
const bible: CharacterBible = {
  schemaVersion: "1.0",
  id: "bible-1",
  projectId: "project-1",
  version: 1,
  revision: 3,
  status: "approved",
  displayName: "Hero",
  identityDescription: "The uploaded image is the only visual source of truth.",
  negativeConstraints: ["Never synthesize replacement pixels"],
  distinguishingFeatures: ["Preserve every source pixel"],
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
const reference: CharacterReferenceAsset = {
  id: "reference-1",
  projectId: "project-1",
  bibleId: bible.id,
  sourceVersionId: "source-1",
  role: "identity-primary",
  canonicalView: "frontal",
  rightsClassification: "owned-by-user",
  rightsAttestedByUserId: "user-1",
  rightsAttestedAt: timestamp,
  artifact: {
    objectKey: "projects/project-1/character-rig/references/source.png",
    contentType: "image/png",
    sizeBytes: 100,
    sha256: "c".repeat(64),
    createdAt: timestamp,
    retentionExpiresAt: null,
  },
  width: 1200,
  height: 1600,
  createdAt: timestamp,
};

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
    rig: null,
    jobs: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CharacterStudioDialog source-preserving workflow", () => {
  it("aborts its state request when the dialog unmounts", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.mocked(getCharacterRigStudio).mockImplementation((_projectId, signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    });

    const view = renderStudio();
    await waitFor(() => expect(observedSignal?.aborted).toBe(false));
    view.unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("normalizes descriptive fields before saving", async () => {
    vi.mocked(saveCharacterBibleDraft).mockResolvedValue({
      ...bible,
      status: "draft",
      approvedAt: null,
      approvedByUserId: null,
    });
    const view = renderStudio();
    await waitFor(() => expect(view.container.querySelector(".character-bible-form")).toBeTruthy());
    const form = view.container.querySelector(".character-bible-form")!;
    const name = form.querySelector<HTMLInputElement>('input:not([type="color"]):not([type="number"])')!;
    const textareas = form.querySelectorAll<HTMLTextAreaElement>("textarea");
    fireEvent.change(name, { target: { value: "Hero" } });
    fireEvent.change(textareas[0]!, {
      target: { value: "A source-preserving character description." },
    });
    fireEvent.change(textareas[1]!, {
      target: { value: "  blue glasses  \n\n scar above eye " },
    });
    fireEvent.change(textareas[2]!, {
      target: { value: " preserve all pixels \n never generate content " },
    });
    fireEvent.click(
      Array.from(form.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("المسودة"),
      )!,
    );

    await waitFor(() => expect(saveCharacterBibleDraft).toHaveBeenCalledOnce());
    expect(saveCharacterBibleDraft).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        displayName: "Hero",
        distinguishingFeatures: ["blue glasses", "scar above eye"],
        negativeConstraints: ["preserve all pixels", "never generate content"],
      }),
    );
  });

  it("saves dirty metadata before approving its returned revision", async () => {
    const draft = {
      ...bible,
      status: "draft" as const,
      approvedAt: null,
      approvedByUserId: null,
    };
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible: draft,
      references: [],
      rig: null,
      jobs: [],
    });
    const saved = { ...draft, revision: 4, displayName: "Hero revised" };
    vi.mocked(saveCharacterBibleDraft).mockResolvedValue(saved);
    vi.mocked(approveCharacterBible).mockResolvedValue({
      ...saved,
      revision: 5,
      status: "approved",
      approvedAt: timestamp,
      approvedByUserId: "user-1",
    });
    const view = renderStudio();

    await view.findByDisplayValue("Hero");
    fireEvent.change(view.getByDisplayValue("Hero"), {
      target: { value: "Hero revised" },
    });
    fireEvent.click(view.getByRole("button", { name: /حفظ واعتماد البيانات/u }));

    await waitFor(() => expect(approveCharacterBible).toHaveBeenCalledOnce());
    expect(approveCharacterBible).toHaveBeenCalledWith("project-1", saved.id, 4);
  });

  it("locks only the current upload as the frontal primary source", async () => {
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible,
      references: [],
      rig: null,
      jobs: [],
    });
    vi.mocked(addCurrentSourceCharacterReference).mockResolvedValue(reference);
    const view = renderStudio();

    await view.findByText(/المصدر الأصلي موثّق|يلزم توثيق المصدر الحالي/u);
    fireEvent.click(view.container.querySelectorAll(".character-studio-steps button")[1]!);
    const checkbox = view.container.querySelector<HTMLInputElement>('.rights-attestation input')!;
    fireEvent.click(checkbox);
    fireEvent.click(view.getByRole("button", { name: /قفل الصورة الحالية/u }));

    await waitFor(() =>
      expect(addCurrentSourceCharacterReference).toHaveBeenCalledWith(
        "project-1",
        {
          bibleId: bible.id,
          sourceVersionId: "source-1",
          role: "identity-primary",
          canonicalView: "frontal",
          rightsClassification: "user-provided-private-reference",
        },
      ),
    );
  });

  it("queues PSD compilation with the locked source version", async () => {
    vi.mocked(getCharacterRigStudio).mockResolvedValue({
      bible,
      references: [reference],
      rig: null,
      jobs: [],
    });
    vi.mocked(compileCharacterRig).mockResolvedValue({
      rig: sourceRig(),
      job: {
        id: "job-1",
        projectId: "project-1",
        type: "compile-rig",
        status: "queued",
        operationKey: "compile-source-1",
        requestHash: "d".repeat(64),
        payload: {},
        attempt: 0,
        maxAttempts: 2,
        nextAttemptAt: timestamp,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      replayed: false,
    });
    const view = renderStudio();

    await view.findByText(/بصمة المصدر محفوظة/u);
    fireEvent.click(view.container.querySelectorAll(".character-studio-steps button")[2]!);
    fireEvent.click(view.getByRole("button", { name: /بناء PSD من المصدر الحالي/u }));

    await waitFor(() => expect(compileCharacterRig).toHaveBeenCalledWith(
      "project-1",
      {
        bibleId: bible.id,
        sourceVersionId: "source-1",
        width: 1200,
        height: 1600,
      },
    ));
    expect(view.queryByText(/توليد زاوية/u)).toBeNull();
    expect(view.queryByText(/بناء نموذج الهوية/u)).toBeNull();
  });
});

function sourceRig(): CharacterRigVersion {
  return {
    schemaVersion: "1.0",
    id: "rig-1",
    projectId: "project-1",
    bibleId: bible.id,
    version: 1,
    status: "draft",
    pipeline: "source-preserving",
    failureCode: null,
    sourceFingerprint: "e".repeat(64),
    source: {
      sourceVersionId: "source-1",
      referenceId: reference.id,
      artifact: reference.artifact,
      layerDocumentRevision: 1,
      pixelIdentityRequired: true,
    },
    canvas: { width: 1200, height: 1600 },
    nodes: [],
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
