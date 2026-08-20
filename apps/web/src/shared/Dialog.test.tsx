// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Dialog } from "./Dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("restores focus synchronously after Escape closes the dialog", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              setOpen(true);
            }}
          >فتح</button>
          {open && (
            <Dialog title="اختبار" onClose={() => setOpen(false)}>
              <button type="button">إجراء</button>
            </Dialog>
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "فتح" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
