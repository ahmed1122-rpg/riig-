import { describe, expect, it } from "vitest";
import {
  buildViewSearch,
  resolveEntryIntent,
  resolveRootSurface,
} from "./entryState";

describe("marketing entry state", () => {
  it("routes an ordinary signed-out visit to marketing after session resolution", () => {
    const intent = resolveEntryIntent("");
    expect(intent).toEqual({
      initialView: "dashboard",
      billingReturn: false,
      passwordReset: false,
      workspace: { mode: "image", project: null },
    });
    expect(
      resolveRootSurface({
        sessionPhase: "resolved",
        authenticated: false,
        guestStudioOpen: false,
        authOpen: false,
        billingReturn: intent.billingReturn,
      }),
    ).toBe("marketing");
  });

  it("keeps the splash visible while the session request is unresolved", () => {
    expect(
      resolveRootSurface({
        sessionPhase: "checking",
        authenticated: false,
        guestStudioOpen: false,
        authOpen: false,
        billingReturn: false,
      }),
    ).toBe("splash");
  });

  it("keeps a server outage distinct from an anonymous session", () => {
    expect(
      resolveRootSurface({
        sessionPhase: "unavailable",
        authenticated: false,
        guestStudioOpen: false,
        authOpen: false,
        billingReturn: false,
      }),
    ).toBe("session-unavailable");
  });

  it.each([
    "?billingReturn=1",
    "?sandbox_checkout=checkout_123&provider=sandbox-card",
    "?payment=cancelled&session_id=session_123",
  ])("preserves billing return intent for %s", (search) => {
    const intent = resolveEntryIntent(search);
    expect(intent.initialView).toBe("billing");
    expect(intent.billingReturn).toBe(true);
    expect(
      resolveRootSurface({
        sessionPhase: "resolved",
        authenticated: false,
        guestStudioOpen: false,
        authOpen: false,
        billingReturn: intent.billingReturn,
      }),
    ).toBe("studio");
  });

  it("opens a reset link directly without a marketing or session splash flash", () => {
    const intent = resolveEntryIntent("?token=reset-token");
    expect(intent.passwordReset).toBe(true);
    expect(
      resolveRootSurface({
        sessionPhase: "checking",
        authenticated: false,
        guestStudioOpen: false,
        authOpen: intent.passwordReset,
        billingReturn: false,
      }),
    ).toBe("auth");
  });

  it("opens the creator shell when the visitor explicitly chooses guest mode", () => {
    expect(
      resolveRootSurface({
        sessionPhase: "resolved",
        authenticated: false,
        guestStudioOpen: true,
        authOpen: false,
        billingReturn: false,
      }),
    ).toBe("studio");
  });

  it("restores a workspace route and its source version from the URL", () => {
    const intent = resolveEntryIntent(
      "?view=workspace&mode=book&projectId=project-1&projectName=كتاب&sourceVersionId=source-2&sourceVersion=2",
    );

    expect(intent.initialView).toBe("workspace");
    expect(intent.workspace).toEqual({
      mode: "book",
      project: {
        id: "project-1",
        name: "كتاب",
        currentSourceVersionId: "source-2",
        currentSourceVersionNumber: 2,
      },
    });
  });

  it("builds a shareable workspace URL and removes transient payment data", () => {
    const search = buildViewSearch(
      "?payment=cancelled&checkout_id=local-checkout&session_id=secret",
      "workspace",
      {
        mode: "image",
        project: {
          id: "project-1",
          name: "شخصية",
          currentSourceVersionId: "source-3",
          currentSourceVersionNumber: 3,
        },
      },
    );

    expect(search).toContain("view=workspace");
    expect(search).toContain("projectId=project-1");
    expect(search).toContain("sourceVersion=3");
    expect(search).not.toContain("payment");
    expect(search).not.toContain("checkout_id");
    expect(search).not.toContain("secret");
  });
});
