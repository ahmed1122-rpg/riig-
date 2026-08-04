import type { ExportJob, ProcessingJob } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import {
  toAdminExportJobDto,
  toAdminProcessingJobDto,
  toExportJobDto,
  toProcessingJobDto,
} from "./job-dtos.js";

const timestamp = "2026-08-03T12:00:00.000Z";
const traceparent =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("job DTO projectors", () => {
  it("removes tracing, lease, storage, and private OCR fields publicly", () => {
    const exportDto = toExportJobDto(exportJob());
    const processingDto = toProcessingJobDto(processingJob());

    for (const dto of [exportDto, processingDto]) {
      expect(dto).not.toHaveProperty("correlationId");
      expect(dto).not.toHaveProperty("traceContext");
      expect(dto).not.toHaveProperty("nextAttemptAt");
      expect(dto).not.toHaveProperty("leaseOwner");
      expect(dto).not.toHaveProperty("leaseExpiresAt");
    }
    expect(exportDto.artifact).toEqual({
      filename: "result.psd",
      sizeBytes: 64,
      sha256: "a".repeat(64),
      expiresAt: timestamp,
    });
    expect(exportDto.artifact).not.toHaveProperty("objectKey");
    expect(processingDto.options.pdfRegionOcr).toEqual({
      pageNumber: 1,
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      baseRevision: 2,
    });
    expect(processingDto.options.pdfRegionOcr).not.toHaveProperty(
      "actorUserId",
    );
    expect(processingDto.options.pdfRegionOcr).not.toHaveProperty(
      "operationId",
    );
  });

  it("exposes bounded operational diagnostics to administrators", () => {
    const processingDto = toAdminProcessingJobDto(processingJob());
    const exportDto = toAdminExportJobDto(exportJob());

    for (const dto of [processingDto, exportDto]) {
      expect(dto).toMatchObject({
        correlationId: "request-123",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        attempt: { current: 2, maximum: 3, nextAt: timestamp },
        error: { code: expect.any(String) },
        lease: { owner: "worker-1", expiresAt: timestamp },
      });
      expect(dto).not.toHaveProperty("traceContext");
    }
  });
});

function exportJob(): ExportJob {
  return {
    id: crypto.randomUUID(),
    correlationId: "request-123",
    traceContext: { traceparent, tracestate: "vendor=value" },
    projectId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    documentRevision: 2,
    projectKind: "image",
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "character-basic",
    status: "failed",
    progress: 80,
    attempt: 2,
    maxAttempts: 3,
    nextAttemptAt: timestamp,
    leaseOwner: "worker-1",
    leaseExpiresAt: timestamp,
    errorCode: "EXPORT_WORKER_FAILED",
    createdAt: timestamp,
    updatedAt: timestamp,
    artifact: {
      objectKey: "private/artifacts/result.psd",
      filename: "result.psd",
      sizeBytes: 64,
      sha256: "a".repeat(64),
      expiresAt: timestamp,
    },
  };
}

function processingJob(): ProcessingJob {
  return {
    id: crypto.randomUUID(),
    correlationId: "request-123",
    traceContext: { traceparent, tracestate: "vendor=value" },
    projectId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    projectKind: "book",
    options: {
      pdfSeparationMode: "line",
      pdfRegionOcr: {
        pageNumber: 1,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        baseRevision: 2,
        actorUserId: crypto.randomUUID(),
        operationId: "regional-ocr-1",
      },
    },
    status: "failed",
    progress: 50,
    attempt: 2,
    maxAttempts: 3,
    nextAttemptAt: timestamp,
    leaseOwner: "worker-1",
    leaseExpiresAt: timestamp,
    errorCode: "OCR_FAILED",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
