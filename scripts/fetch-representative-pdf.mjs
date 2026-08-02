import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_BYTES = 30 * 1024 * 1024;

export function loadRepresentativePdfConfiguration(
  environment = process.env,
  workspace = process.cwd(),
) {
  const source = required(environment.REPRESENTATIVE_PDF_URL, "REPRESENTATIVE_PDF_URL");
  const sourceUrl = new URL(source);
  if (sourceUrl.protocol !== "https:") {
    throw new Error("REPRESENTATIVE_PDF_URL must use HTTPS.");
  }
  if (sourceUrl.username || sourceUrl.password) {
    throw new Error("REPRESENTATIVE_PDF_URL must not contain URL credentials.");
  }

  const sha256 = required(
    environment.REPRESENTATIVE_PDF_SHA256,
    "REPRESENTATIVE_PDF_SHA256",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new Error("REPRESENTATIVE_PDF_SHA256 must contain 64 hexadecimal characters.");
  }

  const maxBytes = positiveInteger(
    environment.MAX_UPLOAD_BYTES,
    DEFAULT_MAX_BYTES,
    "MAX_UPLOAD_BYTES",
  );
  const minBytes = positiveInteger(
    environment.REPRESENTATIVE_PDF_MIN_BYTES,
    undefined,
    "REPRESENTATIVE_PDF_MIN_BYTES",
  );
  if (minBytes > maxBytes) {
    throw new Error("REPRESENTATIVE_PDF_MIN_BYTES cannot exceed MAX_UPLOAD_BYTES.");
  }

  const outputPath = resolve(
    workspace,
    environment.LOAD_PDF_PATH ?? ".tmp/representative-load.pdf",
  );
  const outputRelativePath = relative(resolve(workspace), outputPath);
  if (
    outputRelativePath === "" ||
    outputRelativePath === ".." ||
    outputRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(outputRelativePath)
  ) {
    throw new Error("LOAD_PDF_PATH must resolve to a file inside the workspace.");
  }

  return { sourceUrl, sha256, minBytes, maxBytes, outputPath };
}

export async function fetchRepresentativePdf(
  configuration,
  fetchImplementation = fetch,
) {
  const response = await fetchImplementation(configuration.sourceUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Representative PDF download returned HTTP ${response.status}.`);
  }
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new Error("Representative PDF redirected to a non-HTTPS URL.");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > configuration.maxBytes) {
    throw new Error("Representative PDF exceeds MAX_UPLOAD_BYTES.");
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > configuration.maxBytes) {
    throw new Error("Representative PDF exceeds MAX_UPLOAD_BYTES.");
  }
  if (body.length < configuration.minBytes) {
    throw new Error("Representative PDF is smaller than REPRESENTATIVE_PDF_MIN_BYTES.");
  }
  if (body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Representative load fixture is not a PDF file.");
  }

  const actualSha256 = createHash("sha256").update(body).digest("hex");
  if (actualSha256 !== configuration.sha256) {
    throw new Error("Representative PDF SHA-256 does not match the approved digest.");
  }

  await mkdir(dirname(configuration.outputPath), { recursive: true });
  await writeFile(configuration.outputPath, body, { flag: "wx", mode: 0o600 });
  return {
    path: configuration.outputPath,
    bytes: body.length,
    sha256: actualSha256,
  };
}

function required(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function positiveInteger(value, fallback, name) {
  const normalized = value?.trim();
  if (!normalized && fallback !== undefined) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function main() {
  const configuration = loadRepresentativePdfConfiguration();
  const result = await fetchRepresentativePdf(configuration);
  process.stdout.write(
    `${JSON.stringify({
      event: "representative_pdf.verified",
      path: relative(process.cwd(), result.path),
      bytes: result.bytes,
      sha256: result.sha256,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
