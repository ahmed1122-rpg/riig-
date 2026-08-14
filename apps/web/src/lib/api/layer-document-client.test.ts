import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./transport", () => ({ request }));

import {
  getProjectLayerDocument,
  runLayerDocumentCommand,
  splitPdfTextLayer,
  updateLayerDocument,
} from "./layer-document-client";

describe("layer document client routes", () => {
  beforeEach(() => request.mockReset());

  it("keeps the source-specific document route encoded", async () => {
    request.mockResolvedValue({});
    const signal = new AbortController().signal;

    await getProjectLayerDocument("project/1", signal, "source 1");

    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project%2F1/layer-document?sourceVersionId=source%201",
      { signal },
    );
  });

  it("posts atomic layer commands with a stable operation identity", async () => {
    request.mockResolvedValue({});
    const command = {
      kind: "update-state" as const,
      scope: { kind: "layers" as const, layerIds: ["layer-1"] },
      locked: true,
    };
    await runLayerDocumentCommand(
      "project/1",
      "source-1",
      4,
      command,
      "command-operation-001",
    );
    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project%2F1/layer-document/commands",
      {
        method: "POST",
        headers: { "x-idempotency-key": "command-operation-001" },
        body: JSON.stringify({
          sourceVersionId: "source-1",
          baseRevision: 4,
          command,
        }),
      },
    );
  });

  it("sends a stable operation identity with the autosave PATCH", async () => {
    request.mockResolvedValue({});
    const layers = [{
      id: "layer-1",
      name: "+layer",
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 1,
    }];

    await updateLayerDocument(
      "project-1",
      "source-1",
      3,
      layers,
      "autosave-operation-001",
    );

    expect(request).toHaveBeenCalledWith(
      "/v1/projects/project-1/layer-document",
      {
        method: "PATCH",
        headers: { "x-idempotency-key": "autosave-operation-001" },
        body: JSON.stringify({
          sourceVersionId: "source-1",
          baseRevision: 3,
          layers,
        }),
      },
    );
  });

  it("keeps PDF edit idempotency on the extracted client", async () => {
    request.mockResolvedValue({});

    await splitPdfTextLayer("project-1", {
      sourceVersionId: "source-1",
      baseRevision: 1,
      layerId: "layer-1",
      offset: 4,
    });

    expect(request.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project-1/layer-document/text/split",
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "x-idempotency-key": expect.any(String) },
    });
  });
});
