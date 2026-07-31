import type {
  ExportJob,
  LayerDocument,
  LayerNode,
  UploadSession,
} from "@motionprep/contracts";
import { layerLayoutMetadata } from "@motionprep/contracts";

export interface GeneratedArtifact {
  body: Buffer;
  filename: string;
  contentType: string;
}

export function sourceExtension(
  contentType: UploadSession["contentType"],
): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
    "application/pdf": "pdf",
  }[contentType];
}

export function createManifest(
  job: ExportJob,
  document: LayerDocument,
  namingPresetId: string,
  sourceFilename: string,
  sourceSha256: string | null,
  layerFiles: ReadonlyMap<string, string>,
) {
  return {
    schemaVersion: "1.0",
    projectId: job.projectId,
    sourceVersionId: job.sourceVersionId,
    namingPresetId,
    generatedAt: new Date().toISOString(),
    source: {
      file: sourceFilename,
      ...(sourceSha256 ? { sha256: sourceSha256 } : {}),
    },
    document: {
      width: document.width,
      height: document.height,
      colorSpace: document.colorSpace,
      revision: document.revision ?? 1,
      pages: document.pages ?? [],
    },
    layers: document.layers.map((layer) =>
      serializeLayer(layer, layerFiles.get(layer.id)),
    ),
  };
}

export function createTextArtifact(
  job: ExportJob,
  document: LayerDocument,
): GeneratedArtifact {
  const layers = document.layers
    .filter(
      (layer): layer is LayerNode & { fullText: string } =>
        layer.kind === "text" && Boolean(layer.fullText),
    )
    .sort(compareReadingOrder);
  const basename = `motionprep-${job.projectId}`;

  if (job.format === "txt") {
    const pages = new Map<number, string[]>();
    for (const layer of layers) {
      const page = layer.pageNumber ?? 1;
      const values = pages.get(page) ?? [];
      values.push(layer.fullText);
      pages.set(page, values);
    }
    const text = [...pages.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, values]) => values.join("\n"))
      .join("\n\f\n");
    return {
      body: Buffer.from(`\uFEFF${text}`, "utf8"),
      filename: `${basename}.txt`,
      contentType: "text/plain; charset=utf-8",
    };
  }

  if (job.format === "csv") {
    const header = [
      "page_number",
      "reading_order",
      "name",
      "full_text",
      "x",
      "y",
      "width",
      "height",
      "direction",
    ];
    const rows = layers.map((layer) =>
      [
        layer.pageNumber ?? 1,
        layer.readingOrder ?? "",
        layer.name,
        layer.fullText,
        layer.bounds?.x ?? "",
        layer.bounds?.y ?? "",
        layer.bounds?.width ?? "",
        layer.bounds?.height ?? "",
        layer.direction ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    return {
      body: Buffer.from(
        `\uFEFF${[header.join(","), ...rows].join("\r\n")}`,
        "utf8",
      ),
      filename: `${basename}.csv`,
      contentType: "text/csv; charset=utf-8",
    };
  }

  return {
    body: Buffer.from(JSON.stringify(document, null, 2), "utf8"),
    filename: `${basename}.json`,
    contentType: "application/json",
  };
}

function serializeLayer(layer: LayerNode, file?: string) {
  return {
    id: layer.id,
    parentId: layer.parentId,
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    locked: layer.locked,
    fixed: layer.fixed,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
    ...(file ? { file } : {}),
    ...(layer.fullText ? { fullText: layer.fullText } : {}),
    ...layerLayoutMetadata(layer),
    ...(layer.fillColor ? { fillColor: layer.fillColor } : {}),
  };
}

function compareReadingOrder(
  left: LayerNode,
  right: LayerNode,
): number {
  return (
    (left.pageNumber ?? 1) - (right.pageNumber ?? 1) ||
    (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
    left.zIndex - right.zIndex
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}
