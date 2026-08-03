/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useModalDrawer } from "./useModalDrawer";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function Harness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useModalDrawer({
    active: open,
    dialogRef,
    backgroundRef,
    triggerRef,
    onClose: () => setOpen(false),
  });

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        فتح القائمة
      </button>
      <main ref={backgroundRef}>المحتوى</main>
      {open && (
        <aside ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
          <button type="button" data-drawer-initial-focus onClick={() => setOpen(false)}>
            إغلاق
          </button>
          <button type="button">آخر إجراء</button>
        </aside>
      )}
    </div>
  );
}

describe("useModalDrawer", () => {
  it("isolates background content, traps focus, and restores the trigger", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    fireEvent.click(trigger);

    const close = screen.getByRole("button", { name: "إغلاق" });
    const last = screen.getByRole("button", { name: "آخر إجراء" });
    const main = screen.getByRole("main", { hidden: true });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(main.hasAttribute("inert")).toBe(true);
    expect(main.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(main.hasAttribute("inert")).toBe(false);
    expect(main.hasAttribute("aria-hidden")).toBe(false);
  });
});
