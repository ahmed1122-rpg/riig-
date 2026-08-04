/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

afterEach(cleanup);

describe("Dashboard activity integration", () => {
  it("renders the real activity surface and an honest guest action", () => {
    const onRequireAuth = vi.fn();
    const view = render(
      <Dashboard
        authenticated={false}
        onRequireAuth={onRequireAuth}
        onOpenWorkspace={vi.fn()}
        onOpenActivityProject={vi.fn()}
        onNavigateProjects={vi.fn()}
        onNavigateExports={vi.fn()}
      />,
    );

    expect(view.getByRole("heading", { name: "النشاط والإنتاج" })).toBeTruthy();
    expect(view.container.querySelector(".processing-card")).toBeNull();
    expect(view.getByText("سجّل الدخول لعرض نشاطك")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "تسجيل الدخول" }));
    expect(onRequireAuth).toHaveBeenCalledOnce();
  });
});
