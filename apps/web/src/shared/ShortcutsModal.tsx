import { useEffect } from "react";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  categoryAr: string;
  items: { keys: string[]; descriptionAr: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    categoryAr: "لوحة الاستوديو والعرض (Canvas & Zoom)",
    items: [
      { keys: ["Ctrl", "+"], descriptionAr: "تكبير اللوحة (Zoom In)" },
      { keys: ["Ctrl", "-"], descriptionAr: "تصغير اللوحة (Zoom Out)" },
      { keys: ["Ctrl", "0"], descriptionAr: "توسيط واحتواء اللوحة (Fit to Screen)" },
      { keys: ["Space", "Drag"], descriptionAr: "سحب وتمرير اللوحة (Pan Canvas)" },
    ],
  },
  {
    categoryAr: "إدارة الطبقات والقص (Layers & Matting)",
    items: [
      { keys: ["Ctrl", "D"], descriptionAr: "مضاعفة الطبقة المحددة (Duplicate Layer)" },
      { keys: ["Delete"], descriptionAr: "حذف الطبقات المحددة" },
      { keys: ["Ctrl", "Shift", "H"], descriptionAr: "إخفاء / إظهار الطبقة المحددة" },
      { keys: ["Ctrl", "L"], descriptionAr: "قفل / فتح الطبقة لحمايتها" },
    ],
  },
  {
    categoryAr: "التصدير والاختصارات العامة",
    items: [
      { keys: ["Ctrl", "S"], descriptionAr: "حفظ المشروع والتعديلات تلقائياً" },
      { keys: ["Ctrl", "E"], descriptionAr: "تصدير حزمة Photoshop PSD و After Effects" },
      { keys: ["?"], descriptionAr: "فتح نافذة الاختصارات التفاعلية" },
      { keys: ["Esc"], descriptionAr: "إغلاق القوائم والنوافذ المنبثقة" },
    ],
  },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === "?" || (event.ctrlKey && event.key === "/")) &&
        !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!open) return null;

  return (
    <Dialog
      title="اختصارات لوحة المفاتيح للاستوديو"
      description="مفاتيح التصفح والتنقل السريعة المصممة لمحرري الرسوم المتحركة والـ Motion Graphics."
      eyebrow="دليل المصمم المحترف"
      onClose={onClose}
      className="shortcuts-dialog"
    >
      <div className="shortcuts-list" dir="rtl">
        {shortcutGroups.map((group) => (
          <section key={group.categoryAr} className="shortcut-group">
            <header className="shortcut-group__head">
              <Icon name="layers" size={16} />
              <strong>{group.categoryAr}</strong>
            </header>
            <div className="shortcut-group__items">
              {group.items.map((item) => (
                <div key={item.descriptionAr} className="shortcut-row">
                  <span className="shortcut-row__desc">{item.descriptionAr}</span>
                  <div className="shortcut-row__keys">
                    {item.keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
