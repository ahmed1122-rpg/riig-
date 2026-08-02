import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fetchRepresentativePdf,
  loadRepresentativePdfConfiguration,
} from "./fetch-representative-pdf.mjs";

const pdf = Buffer.from("%PDF-1.7\nrepresentative fixture\n%%EOF\n");
const sha256 = createHash("sha256").update(pdf).digest("hex");

test("rejects insecure sources and output paths outside the workspace", () => {
  assert.throws(
    () =>
      loadRepresentativePdfConfiguration({
        REPRESENTATIVE_PDF_URL: "http://objects.example.com/load.pdf",
        REPRESENTATIVE_PDF_SHA256: sha256,
        REPRESENTATIVE_PDF_MIN_BYTES: "10",
      }),
    /must use HTTPS/u,
  );
  assert.throws(
    () =>
      loadRepresentativePdfConfiguration(
        {
          REPRESENTATIVE_PDF_URL: "https://objects.example.com/load.pdf",
          REPRESENTATIVE_PDF_SHA256: sha256,
          REPRESENTATIVE_PDF_MIN_BYTES: "10",
          LOAD_PDF_PATH: "../load.pdf",
        },
        "/workspace",
      ),
    /inside the workspace/u,
  );
});

test("downloads only a verified representative PDF", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "motionprep-pdf-"));
  try {
    const configuration = loadRepresentativePdfConfiguration(
      {
        REPRESENTATIVE_PDF_URL: "https://objects.example.com/load.pdf?signature=secret",
        REPRESENTATIVE_PDF_SHA256: sha256,
        REPRESENTATIVE_PDF_MIN_BYTES: String(pdf.length),
        MAX_UPLOAD_BYTES: String(pdf.length),
        LOAD_PDF_PATH: ".tmp/approved.pdf",
      },
      workspace,
    );
    const result = await fetchRepresentativePdf(configuration, async () => ({
      ok: true,
      status: 200,
      url: "https://cdn.example.com/load.pdf",
      headers: new Headers({ "content-length": String(pdf.length) }),
      arrayBuffer: async () => pdf,
    }));

    assert.equal(result.bytes, pdf.length);
    assert.equal(result.sha256, sha256);
    assert.deepEqual(await readFile(result.path), pdf);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects an unexpected digest without publishing a file", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "motionprep-pdf-"));
  try {
    const configuration = loadRepresentativePdfConfiguration(
      {
        REPRESENTATIVE_PDF_URL: "https://objects.example.com/load.pdf",
        REPRESENTATIVE_PDF_SHA256: "0".repeat(64),
        REPRESENTATIVE_PDF_MIN_BYTES: "1",
        LOAD_PDF_PATH: ".tmp/approved.pdf",
      },
      workspace,
    );
    await assert.rejects(
      fetchRepresentativePdf(configuration, async () => ({
        ok: true,
        status: 200,
        url: "https://objects.example.com/load.pdf",
        headers: new Headers(),
        arrayBuffer: async () => pdf,
      })),
      /SHA-256/u,
    );
    await assert.rejects(readFile(configuration.outputPath), /ENOENT/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
