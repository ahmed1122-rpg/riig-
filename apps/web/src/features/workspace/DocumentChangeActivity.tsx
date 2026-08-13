import { Icon } from "../../shared/Icon";
import type { DocumentChangeSummary } from "./documentChangeSummary";

export function DocumentChangeActivity({
  changes,
}: {
  changes: readonly DocumentChangeSummary[];
}) {
  if (changes.length === 0) return null;
  return (
    <details className="pro-layer-command-log pro-document-change-log">
      <summary>فرق عمليات الوثيقة <span>{changes.length}</span></summary>
      <ol>
        {changes.map((change) => (
          <li key={change.id}>
            <Icon name="history" size={12} />
            <span>
              <strong>{change.label}</strong>
              <small>
                <bdi dir="ltr">{change.beforeCount} → {change.afterCount}</bdi> طبقة · أضيفت {change.added.length} · حُذفت {change.removed.length} · عُدلت {change.modified.length}
              </small>
              <ChangeNames label="مضافة" names={change.added} />
              <ChangeNames label="محذوفة" names={change.removed} />
              <ChangeNames label="معدلة" names={change.modified} />
            </span>
            <small>{change.revision === undefined ? "محفوظ" : `r${change.revision}`}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ChangeNames({
  label,
  names,
}: {
  label: string;
  names: readonly string[];
}) {
  if (names.length === 0) return null;
  const visible = names.slice(0, 3).join("، ");
  return (
    <small dir="auto">
      {label}: {visible}{names.length > 3 ? `، و${names.length - 3} أخرى` : ""}
    </small>
  );
}
