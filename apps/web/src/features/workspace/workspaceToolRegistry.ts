import type { IconName } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import type { ApplicationCapabilities } from "@motionprep/contracts";

type WorkspaceToolId =
  | "image.keep"
  | "image.exclude"
  | "image.separate"
  | "image.erase"
  | "image.undo"
  | "image.redo"
  | "pdf.heading"
  | "pdf.line"
  | "pdf.topic"
  | "pdf.exclude"
  | "pdf.undo"
  | "pdf.redo"
  | "pdf.reading-order"
  | "image.edge-refine"
  | "image.merge"
  | "image.turntable"
  | "pdf.region-ocr"
  | "pdf.split"
  | "pdf.merge"
  | "source.versions";

export type ReadyWorkspaceToolId = WorkspaceToolId;

export type WorkspaceToolGroup = "prompts" | "document" | "history";

interface WorkspaceShortcut {
  key: string;
  label: string;
  alt?: boolean;
  modifier?: boolean;
  shift?: boolean;
}

interface WorkspaceToolBase {
  id: WorkspaceToolId;
  mode: ProjectMode | "all";
  label: string;
  icon: IconName;
  group: WorkspaceToolGroup;
  shortcut?: WorkspaceShortcut;
  color?: string;
}

export interface ReadyWorkspaceTool extends WorkspaceToolBase {
  id: ReadyWorkspaceToolId;
  availability: "ready";
  action:
    | "editor-prompt"
    | "editor-undo"
    | "history-redo"
    | "reading-order"
    | "source-versions"
    | "pdf-split"
    | "pdf-merge"
    | "pdf-region-ocr"
    | "image-edge-refine"
    | "image-merge"
    | "character-rig";
  requiresSource: true;
}

export interface ResolvedWorkspaceTool extends ReadyWorkspaceTool {
  available: boolean;
  unavailableReason?: string;
}

const tools: readonly ReadyWorkspaceTool[] = [
  {
    id: "image.keep",
    mode: "image",
    label: "ملء / احتفظ",
    icon: "brush",
    group: "prompts",
    shortcut: { key: "1", label: "1" },
    color: "#34d399",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "image.exclude",
    mode: "image",
    label: "استبعد",
    icon: "brush",
    group: "prompts",
    shortcut: { key: "2", label: "2" },
    color: "#fb7185",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "image.separate",
    mode: "image",
    label: "جزء مستقل",
    icon: "split",
    group: "prompts",
    shortcut: { key: "3", label: "3" },
    color: "#38bdf8",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "image.erase",
    mode: "image",
    label: "ممحاة",
    icon: "eraser",
    group: "prompts",
    shortcut: { key: "e", label: "E" },
    color: "#cbd5e1",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "image.undo",
    mode: "image",
    label: "تراجع عن الإرشاد",
    icon: "undo",
    group: "history",
    shortcut: { key: "z", label: "Ctrl+Z", modifier: true },
    availability: "ready",
    action: "editor-undo",
    requiresSource: true,
  },
  {
    id: "image.redo",
    mode: "image",
    label: "إعادة تعديل محفوظ",
    icon: "refresh",
    group: "history",
    shortcut: {
      key: "z",
      label: "Ctrl+Shift+Z",
      modifier: true,
      shift: true,
    },
    availability: "ready",
    action: "history-redo",
    requiresSource: true,
  },
  {
    id: "pdf.heading",
    mode: "book",
    label: "عنوان",
    icon: "highlighter",
    group: "prompts",
    shortcut: { key: "h", label: "H" },
    color: "#f4c84a",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "pdf.line",
    mode: "book",
    label: "سطر",
    icon: "scanText",
    group: "prompts",
    shortcut: { key: "l", label: "L" },
    color: "#9b7ee8",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "pdf.topic",
    mode: "book",
    label: "فقرة / موضوع",
    icon: "boxSelect",
    group: "prompts",
    shortcut: { key: "t", label: "T" },
    color: "#45c5d6",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "pdf.exclude",
    mode: "book",
    label: "استثناء",
    icon: "eraser",
    group: "prompts",
    shortcut: { key: "x", label: "X" },
    color: "#8f99a6",
    availability: "ready",
    action: "editor-prompt",
    requiresSource: true,
  },
  {
    id: "pdf.reading-order",
    mode: "book",
    label: "ترتيب القراءة",
    icon: "list",
    group: "document",
    shortcut: { key: "r", label: "Alt+R", alt: true },
    availability: "ready",
    action: "reading-order",
    requiresSource: true,
  },
  {
    id: "pdf.undo",
    mode: "book",
    label: "تراجع عن المنطقة",
    icon: "undo",
    group: "history",
    shortcut: { key: "z", label: "Ctrl+Z", modifier: true },
    availability: "ready",
    action: "editor-undo",
    requiresSource: true,
  },
  {
    id: "pdf.redo",
    mode: "book",
    label: "إعادة تعديل محفوظ",
    icon: "refresh",
    group: "history",
    shortcut: {
      key: "z",
      label: "Ctrl+Shift+Z",
      modifier: true,
      shift: true,
    },
    availability: "ready",
    action: "history-redo",
    requiresSource: true,
  },
  {
    id: "image.edge-refine",
    mode: "image",
    label: "تحسين الحواف",
    icon: "scan",
    group: "document",
    availability: "ready",
    action: "image-edge-refine",
    requiresSource: true,
  },
  {
    id: "image.merge",
    mode: "image",
    label: "دمج الطبقات",
    icon: "merge",
    group: "document",
    availability: "ready",
    action: "image-merge",
    requiresSource: true,
  },
  {
    id: "image.turntable",
    mode: "image",
    label: "Character Turntable",
    icon: "refresh",
    group: "document",
    availability: "ready",
    action: "character-rig",
    requiresSource: true,
  },
  {
    id: "pdf.region-ocr",
    mode: "book",
    label: "إعادة OCR للمنطقة",
    icon: "scanText",
    group: "document",
    availability: "ready",
    action: "pdf-region-ocr",
    requiresSource: true,
  },
  {
    id: "pdf.split",
    mode: "book",
    label: "فصل وحدة نصية",
    icon: "split",
    group: "document",
    availability: "ready",
    action: "pdf-split",
    requiresSource: true,
  },
  {
    id: "pdf.merge",
    mode: "book",
    label: "دمج وحدات النص",
    icon: "merge",
    group: "document",
    availability: "ready",
    action: "pdf-merge",
    requiresSource: true,
  },
  {
    id: "source.versions",
    mode: "all",
    label: "إصدارات المصدر",
    icon: "refresh",
    group: "history",
    availability: "ready",
    action: "source-versions",
    requiresSource: true,
  },
];

export function getReadyWorkspaceTools(
  mode: ProjectMode,
  hasSource: boolean,
  features: ApplicationCapabilities["features"],
): ResolvedWorkspaceTool[] {
  return tools
    .filter(
      (tool) => tool.mode === mode || tool.mode === "all",
    )
    .map((tool): ResolvedWorkspaceTool => {
    if (tool.requiresSource && !hasSource) {
      return {
        ...tool,
        available: false,
        unavailableReason: "ارفع مصدرًا وجهّزه أولًا لاستخدام هذه الأداة.",
      };
    }
    if (tool.id === "pdf.region-ocr" && !features.pdfRegionOcr.enabled) {
      return {
        ...tool,
        available: false,
        unavailableReason:
          features.pdfRegionOcr.unavailableReason ??
          "إعادة OCR لمنطقة محددة غير متاحة في بيئة التشغيل الحالية.",
      };
    }
    if (tool.id === "image.turntable" && !features.characterRig.enabled) {
      return {
        ...tool,
        available: false,
        unavailableReason:
          features.characterRig.unavailableReason ??
          "Character Studio is unavailable in the current runtime.",
      };
    }
    return { ...tool, available: true };
  });
}

export function getReadyWorkspaceToolDefinition(
  id: ReadyWorkspaceToolId,
): ReadyWorkspaceTool {
  const tool = tools.find(
    (candidate) => candidate.id === id,
  );
  if (!tool) throw new Error(`Unknown ready workspace tool: ${id}`);
  return tool;
}

export function isWorkspaceShortcut(
  tool: ResolvedWorkspaceTool,
  event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  const shortcut = tool.shortcut;
  if (!shortcut || event.key.toLocaleLowerCase() !== shortcut.key) return false;
  const hasModifier = event.ctrlKey || event.metaKey;
  return (
    Boolean(shortcut.alt) === event.altKey &&
    Boolean(shortcut.modifier) === hasModifier &&
    Boolean(shortcut.shift) === event.shiftKey
  );
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export interface WorkspaceEditorCommand {
  id: ReadyWorkspaceToolId;
  sequence: number;
}

export type WorkspaceToolDispatch =
  | { kind: "unavailable"; reason: string }
  | { kind: "reading-order" }
  | { kind: "source-versions" }
  | { kind: "pdf-split" }
  | { kind: "pdf-merge" }
  | { kind: "pdf-region-ocr" }
  | { kind: "image-edge-refine" }
  | { kind: "image-merge" }
  | { kind: "character-rig" }
  | {
      kind: "editor";
      id: ReadyWorkspaceToolId;
      selectPrompt: boolean;
    };

export function resolveWorkspaceToolDispatch(
  tool: ResolvedWorkspaceTool,
): WorkspaceToolDispatch {
  if (!tool.available) {
    return {
      kind: "unavailable",
      reason: tool.unavailableReason ?? "هذه الأداة غير متاحة للمصدر الحالي.",
    };
  }
  if (tool.action === "reading-order") return { kind: "reading-order" };
  if (tool.action === "source-versions") return { kind: "source-versions" };
  if (tool.action === "pdf-split") return { kind: "pdf-split" };
  if (tool.action === "pdf-merge") return { kind: "pdf-merge" };
  if (tool.action === "pdf-region-ocr") return { kind: "pdf-region-ocr" };
  if (tool.action === "image-edge-refine") {
    return { kind: "image-edge-refine" };
  }
  if (tool.action === "image-merge") return { kind: "image-merge" };
  if (tool.action === "character-rig") return { kind: "character-rig" };
  return {
    kind: "editor",
    id: tool.id,
    selectPrompt: tool.action === "editor-prompt",
  };
}
