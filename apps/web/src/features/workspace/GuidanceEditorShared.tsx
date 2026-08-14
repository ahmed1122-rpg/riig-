import { useEffect, useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../shared/Icon";
import {
  getReadyWorkspaceToolDefinition,
  type ReadyWorkspaceToolId,
} from "./workspaceToolRegistry";

export type {
  ReadyWorkspaceToolId,
  WorkspaceEditorCommand,
} from "./workspaceToolRegistry";

export type CorrectionMode = "manual" | "guided";
export type ReviewState = "editing" | "refined" | "accepted";

export interface Point {
  x: number;
  y: number;
}

export interface SharedEditorProps {
  onNotify: (message: string) => void;
}

export interface GuidancePromptTool<Id extends string> {
  toolId: ReadyWorkspaceToolId;
  id: Id;
  label: string;
  shortcut: string;
  color: string;
  icon: IconName;
}

export function createGuidancePromptTools<Id extends string>(
  tools: readonly (readonly [ReadyWorkspaceToolId, Id])[],
  fallbackColor: string,
): GuidancePromptTool<Id>[] {
  return tools.map(([toolId, id]) => {
    const tool = getReadyWorkspaceToolDefinition(toolId);
    return {
      toolId,
      id,
      label: tool.label,
      shortcut: tool.shortcut?.label ?? "",
      color: tool.color ?? fallbackColor,
      icon: tool.icon,
    };
  });
}

export function useGuidanceReview(guidanceRevision: number) {
  const [reviewState, setReviewState] = useState<ReviewState>("editing");
  const [version, setVersion] = useState(guidanceRevision);
  const [applying, setApplying] = useState(false);
  const [applyWarnings, setApplyWarnings] = useState<string[]>([]);
  useEffect(() => {
    setVersion(guidanceRevision);
    setReviewState("editing");
    setApplyWarnings([]);
  }, [guidanceRevision]);
  return {
    reviewState,
    setReviewState,
    version,
    setVersion,
    applying,
    setApplying,
    applyWarnings,
    setApplyWarnings,
  };
}

export function GuidanceToolButtons<Id extends string>({
  tools,
  activeId,
  onSelect,
}: {
  tools: readonly GuidancePromptTool<Id>[];
  activeId: Id;
  onSelect: (tool: GuidancePromptTool<Id>) => void;
}) {
  return tools.map((tool) => (
    <button
      key={tool.id}
      type="button"
      className={activeId === tool.id ? "is-active" : ""}
      aria-pressed={activeId === tool.id}
      title={`${tool.label} (${tool.shortcut})`}
      onClick={() => onSelect(tool)}
    >
      <i
        style={
          { "--guide-color": tool.color } as React.CSSProperties
        }
      />
      <Icon name={tool.icon} size={15} />
      <span>{tool.label}</span>
      <kbd>{tool.shortcut}</kbd>
    </button>
  ));
}

export function GuidanceHistoryActions({
  canUndo,
  onUndo,
  onClear,
}: {
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <button
        className="quiet-action"
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="تراجع Ctrl+Z"
      >
        <Icon name="undo" size={14} /> تراجع
      </button>
      <button className="quiet-action" type="button" onClick={onClear}>
        <Icon name="close" size={14} /> مسح
      </button>
    </>
  );
}

export function GuidanceReview({
  applying,
  actionIcon,
  applyingLabel,
  actionLabel,
  onApply,
  reviewState,
  version,
  summaryTitle,
  summaryDetail,
  warnings,
  onAccept,
  acceptedLabel,
  disabled = false,
  disabledReason,
}: {
  applying: boolean;
  actionIcon: IconName;
  applyingLabel: string;
  actionLabel: string;
  onApply: () => void | Promise<void>;
  reviewState: ReviewState;
  version: number;
  summaryTitle: string;
  summaryDetail: ReactNode;
  warnings?: ReactNode;
  onAccept: () => void;
  acceptedLabel: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const disabledReasonId = useId();
  return (
    <div className="guidance-review">
      <button
        className="refine-button"
        type="button"
        onClick={() => void onApply()}
        disabled={applying || disabled}
        aria-describedby={disabledReason ? disabledReasonId : undefined}
      >
        <Icon name={actionIcon} size={15} />{" "}
        {applying ? applyingLabel : actionLabel}
      </button>
      {disabledReason && (
        <small id={disabledReasonId} role="status">
          {disabledReason}
        </small>
      )}
      {reviewState === "refined" && (
        <div className="refinement-summary">
          <Icon name="target" size={14} />
          <span>
            <strong>{summaryTitle}</strong>
            <small>{summaryDetail}</small>
          </span>
        </div>
      )}
      {warnings}
      {reviewState === "refined" && (
        <div className="review-actions">
          <button
            type="button"
            className="accept-refinement"
            onClick={onAccept}
          >
            <Icon name="check" size={14} /> قبول v{version}
          </button>
        </div>
      )}
      {reviewState === "accepted" && (
        <div className="accepted-feedback">
          <span className="accepted-state">
            <Icon name="check" size={14} /> {acceptedLabel}
          </span>
        </div>
      )}
    </div>
  );
}

const processingModes: {
  id: CorrectionMode;
  label: string;
  hint: string;
}[] = [
  { id: "manual", label: "يدوي", hint: "أنت تنشئ كل منطقة" },
  { id: "guided", label: "موجّه", hint: "الأسرع: اقترح ثم صحّح موضعيًا" },
];

export function normalizedPoint(
  event:
    | React.PointerEvent<SVGSVGElement>
    | React.MouseEvent<SVGSVGElement>,
): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    ),
    y: Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    ),
  };
}

export function ProcessingModeControl({
  value,
  onChange,
}: {
  value: CorrectionMode;
  onChange: (value: CorrectionMode) => void;
}) {
  return (
    <div
      className="guidance-mode-control"
      role="radiogroup"
      aria-label="طريقة المعالجة"
    >
      {processingModes.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={value === item.id}
          className={value === item.id ? "is-active" : ""}
          title={item.hint}
          onClick={() => onChange(item.id)}
        >
          {item.id === "guided" && <Icon name="spark" size={13} />}
          <span>{item.label}</span>
          {item.id === "guided" && <small>موصى به</small>}
        </button>
      ))}
    </div>
  );
}

export function WorkflowStrip({ current }: { current: ReviewState }) {
  const items = [
    "اقتراح تلقائي",
    "إشارات المستخدم",
    "تحسين موضعي",
    "فحص الحواف / القراءة",
    "قبول النسخة",
  ];
  const activeIndex =
    current === "editing" ? 1 : current === "refined" ? 3 : 4;

  return (
    <ol className="guidance-workflow" aria-label="سير التحسين الموضعي">
      {items.map((item, index) => (
        <li
          key={item}
          className={
            index < activeIndex
              ? "is-done"
              : index === activeIndex
                ? "is-current"
                : ""
          }
        >
          <span>
            {index < activeIndex ? (
              <Icon name="check" size={10} />
            ) : (
              index + 1
            )}
          </span>
          <small>{item}</small>
        </li>
      ))}
    </ol>
  );
}
