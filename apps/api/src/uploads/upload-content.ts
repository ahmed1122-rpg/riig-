import type { Readable } from "node:stream";
import type { SourceType } from "@motionprep/contracts";

export interface PreparedUploadContent {
  readonly detectedContentType: SourceType | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  openStream(): Readable;
}
