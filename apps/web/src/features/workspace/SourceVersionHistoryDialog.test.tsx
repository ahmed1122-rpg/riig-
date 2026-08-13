/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listSourceVersionRestores,
  listSourceVersions,
  restoreSourceVersion,
} from "../../lib/api";
import { SourceVersionHistoryDialog } from "./SourceVersionHistoryDialog";

vi.mock("../../lib/api", () => ({
  listSourceVersionRestores: vi.fn(),
  listSourceVersions: vi.fn(),
  restoreSourceVersion: vi.fn(),
}));

const currentVersion = {
  id: "source-1",
  versionNumber: 1,
  filename: "current.png",
  status: "ready",
  createdAt: "2026-08-11T00:00:00.000Z",
};
const restoredVersion = {
  id: "source-2",
  versionNumber: 2,
  filename: "restored.png",
  status: "ready",
  createdAt: "2026-08-12T00:00:00.000Z",
};
const restoreResult = {
  project: {
    id: "project-1",
    currentSourceVersionId: "source-2",
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourceVersionHistoryDialog", () => {
  it("retries hydration without repeating a committed server restore", async () => {
    vi.mocked(listSourceVersions).mockResolvedValue([
      currentVersion,
      restoredVersion,
    ] as never);
    vi.mocked(listSourceVersionRestores).mockResolvedValue([]);
    vi.mocked(restoreSourceVersion).mockResolvedValue(restoreResult as never);
    const onRestored = vi
      .fn()
      .mockRejectedValueOnce(new Error("تعذر تحميل الطبقات"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const onNotify = vi.fn();
    render(
      <SourceVersionHistoryDialog
        projectId="project-1"
        currentSourceVersionId="source-1"
        onClose={onClose}
        onRestored={onRestored}
        onExecuteRestore={async (restore) => restore()}
        onNotify={onNotify}
      />,
    );

    await screen.findByRole("radio", { name: /restored\.png/i });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "عودة للمراجعة" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "استعادة الإصدار المحدد" }),
    );

    await screen.findByRole("alert");
    expect(restoreSourceVersion).toHaveBeenCalledOnce();
    expect(onRestored).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "إلغاء" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "إعادة مزامنة الطبقات" }),
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(restoreSourceVersion).toHaveBeenCalledOnce();
    expect(onRestored).toHaveBeenCalledTimes(2);
    expect(onNotify).toHaveBeenCalledOnce();
  });
});
