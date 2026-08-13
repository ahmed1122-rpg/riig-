export type ViewId =
  | "dashboard"
  | "projects"
  | "workspace"
  | "exports"
  | "billing"
  | "security"
  | "admin"
  | "help"
  | "settings";

export type ProjectMode = ProjectKind;
export type DemoState = "ready" | "loading" | "empty" | "error";
export type { UserRole } from "@motionprep/contracts";
export type AdminView =
  | "overview"
  | "processing"
  | "exports"
  | "users"
  | "billing"
  | "audit"
  | "system";
export type PdfSegmentation = "headings" | "topics" | "sentences" | "lines" | "words" | "characters";

export interface Layer {
  id: string;
  name: string;
  kind: "head" | "body" | "hand" | "face" | "text" | "page" | "group";
  parentId?: string | null;
  visible: boolean;
  locked: boolean;
  fixed?: boolean;
  opacity: number;
  zIndex?: number;
  confidence?: number;
  color: string;
  previewUrl?: string;
  fullContent?: string;
  pageNumber?: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  readingOrder?: number;
  direction?: "ltr" | "rtl";
  textAlign?: "start" | "center" | "end" | "justify";
  fontFamily?: string;
  fontSize?: number;
}
import type { ProjectKind } from "@motionprep/contracts";
