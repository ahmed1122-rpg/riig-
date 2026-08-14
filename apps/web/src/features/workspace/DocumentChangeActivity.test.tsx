// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentChangeActivity } from "./DocumentChangeActivity";

afterEach(cleanup);

describe("DocumentChangeActivity", () => {
  it("shows a bounded before/after operation summary with revision", () => {
    render(<DocumentChangeActivity changes={[{
      id: 1,
      label: "OCR إقليمي",
      revision: 8,
      beforeCount: 3,
      afterCount: 4,
      added: ["+سطر_جديد"],
      removed: [],
      modified: ["+عنوان"],
    }]} />);

    expect(screen.getByText("فرق عمليات الوثيقة").textContent).toContain("1");
    expect(screen.getByText("OCR إقليمي")).toBeTruthy();
    expect(screen.getByText("r8")).toBeTruthy();
    expect(screen.getByText(/3 → 4/u).closest("small")?.textContent)
      .toContain("أضيفت 1");
    expect(screen.getByText(/مضافة:/u).textContent).toContain("+سطر_جديد");
  });
});
