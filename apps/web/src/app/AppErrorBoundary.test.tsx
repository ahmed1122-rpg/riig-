/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppErrorBoundary recovery", () => {
  it("keeps the recovery surface usable when reportError is unavailable", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("reportError", undefined);
    const onError = vi.fn();

    render(
      <AppErrorBoundary onError={onError}>
        <CrashingView shouldThrow />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "محاولة الاستعادة" }),
    ).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "render failed" }),
        componentStack: expect.stringContaining("CrashingView"),
      }),
    );
  });

  it("remounts the application from its durable session after a transient crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    let shouldThrow = true;

    render(
      <AppErrorBoundary>
        <CrashingView shouldThrow={() => shouldThrow} />
      </AppErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(
      screen.getByRole("button", { name: "محاولة الاستعادة" }),
    );

    expect(screen.getByText("session restored")).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "render failed" }),
    );
  });

  it("does not let a reporting-provider failure replace the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "reportError",
      vi.fn(() => {
        throw new Error("reporting unavailable");
      }),
    );
    const onError = vi.fn(() => {
      throw new Error("adapter unavailable");
    });

    render(
      <AppErrorBoundary onError={onError}>
        <CrashingView shouldThrow />
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", {
        name: "حدث خطأ غير متوقع في الواجهة",
      }),
    ).toBeTruthy();
    expect(onError).toHaveBeenCalledOnce();
  });
});

function CrashingView({
  shouldThrow,
}: {
  shouldThrow: boolean | (() => boolean);
}) {
  if (typeof shouldThrow === "function" ? shouldThrow() : shouldThrow) {
    throw new Error("render failed");
  }
  return <p>session restored</p>;
}
