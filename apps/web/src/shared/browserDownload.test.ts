/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, triggerBrowserDownload } from "./browserDownload";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("browser downloads", () => {
  it("uses a temporary attached anchor and removes it after activation", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.isConnected).toBe(true);
        expect(this.download).toBe("artifact.zip");
      });

    triggerBrowserDownload("/v1/exports/1/download", "artifact.zip");

    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a")).toBeNull();
  });

  it("always revokes a temporary object URL", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("download blocked");
    });

    expect(() => downloadBlob(["payload"], {
      filename: "data.txt",
      type: "text/plain;charset=utf-8",
    })).toThrow("download blocked");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector("a")).toBeNull();
  });
});
