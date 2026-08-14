// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceUploadStatus } from "./SourceUploadStatus";

afterEach(cleanup);

describe("SourceUploadStatus accessibility", () => {
  it("keeps the empty-state details disclosure named on compact layouts", () => {
    render(
      <SourceUploadStatus
        mode="book"
        fileName=""
        version={0}
        state="empty"
        progress={0}
        detailsOpen={false}
        onChoose={vi.fn()}
        onToggleDetails={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const disclosure = screen.getByRole("button", {
      name: "اختر ملف المصدر، عرض التفاصيل",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });
});
