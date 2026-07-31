import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import {
  getReadyWorkspaceTools,
  type ResolvedWorkspaceTool,
  type WorkspaceToolGroup,
} from "./workspaceToolRegistry";

const groupLabels: Record<WorkspaceToolGroup, string> = {
  prompts: "التحديد الموجّه",
  document: "المستند",
  history: "التراجع",
};

interface WorkspaceToolRailProps {
  mode: ProjectMode;
  activeTool: string;
  hasSource: boolean;
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
  onToolChange: (tool: ResolvedWorkspaceTool) => void;
}

export function WorkspaceToolRail({
  mode,
  activeTool,
  hasSource,
  collapsed,
  onCollapsedChange,
  onToolChange,
}: WorkspaceToolRailProps) {
  const tools = getReadyWorkspaceTools(mode, hasSource);
  const groups = (["prompts", "document", "history"] as const)
    .map((group) => ({ group, items: tools.filter((tool) => tool.group === group) }))
    .filter(({ items }) => items.length > 0);

  return (
    <aside className={`pro-tool-rail ${collapsed ? "is-collapsed" : ""}`} aria-label={mode === "image" ? "أدوات الصورة" : "أدوات PDF"}>
      <div className="pro-rail-heading">
        {!collapsed && <span>أدوات المصدر</span>}
        <button
          type="button"
          className="pro-icon-button"
          aria-label={collapsed ? "توسيع شريط الأدوات" : "طي شريط الأدوات"}
          aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <Icon name={collapsed ? "panelOpen" : "panelClose"} size={16} />
        </button>
      </div>
      <div className="pro-tool-groups">
        {groups.map(({ group, items }) => (
          <section className="pro-tool-group" key={group} aria-label={groupLabels[group]}>
            {!collapsed && <h3>{groupLabels[group]}</h3>}
            <div>
              {items.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={activeTool === tool.id ? "is-active" : ""}
                  disabled={!tool.available}
                  aria-pressed={activeTool === tool.id}
                  aria-label={`${tool.label}${tool.shortcut ? `، الاختصار ${tool.shortcut.label}` : ""}`}
                  title={!tool.available ? tool.unavailableReason : tool.shortcut ? `${tool.label} (${tool.shortcut.label})` : tool.label}
                  onClick={() => onToolChange(tool)}
                >
                  <Icon name={tool.icon} size={17} />
                  {!collapsed && <span>{tool.label}</span>}
                  {!collapsed && tool.shortcut && <kbd>{tool.shortcut.label}</kbd>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!collapsed && (
        <div className="pro-active-tool" aria-live="polite">
          <span>الأداة النشطة</span>
          <strong>{tools.find((tool) => tool.id === activeTool)?.label ?? "اختر أداة من المحرر"}</strong>
        </div>
      )}
    </aside>
  );
}
