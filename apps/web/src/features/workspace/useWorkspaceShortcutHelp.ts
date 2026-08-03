import { useCallback, useEffect, useState } from "react";

export function useWorkspaceShortcutHelp() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        !isEditing &&
        (event.key === "?" || (event.ctrlKey && event.key === "/"))
      ) {
        event.preventDefault();
        setShortcutsOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  return { shortcutsOpen, closeShortcuts };
}
