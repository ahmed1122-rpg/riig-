/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PdfTextOperationDialog, pdfSplitWordTargets } from "./PdfTextOperationDialog";

afterEach(cleanup);

describe("PDF text split selection", () => {
  it("calculates Unicode code-point offsets for clickable words", () => {
    expect(pdfSplitWordTargets("أهلاً بك هنا")).toEqual([
      { text: "بك", offset: 6 },
      { text: "هنا", offset: 9 },
    ]);
  });

  it("splits before the word selected in the preview", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <PdfTextOperationDialog
        operation="split"
        layers={[{
          id: "text-1",
          name: "+نص",
          kind: "text",
          visible: true,
          locked: false,
          opacity: 100,
          color: "#fff",
          fullText: "أهلاً بك هنا",
          direction: "rtl",
        }]}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "بك" }));
    fireEvent.click(screen.getByRole("button", { name: /تقسيم وحفظ مراجعة/u }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ operation: "split", offset: 6 }));
  });
});
