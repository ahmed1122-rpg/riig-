import { describe, expect, it, vi } from "vitest";
import { commitWorkspaceModeChange } from "./workspaceModeChange";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("commitWorkspaceModeChange", () => {
  it("does not clear local state before guarded navigation commits", async () => {
    const navigation = deferred<boolean>();
    const commitLocalState = vi.fn();
    const result = commitWorkspaceModeChange(
      "image",
      "book",
      () => navigation.promise,
      commitLocalState,
    );

    expect(commitLocalState).not.toHaveBeenCalled();
    navigation.resolve(false);
    await expect(result).resolves.toBe(false);
    expect(commitLocalState).not.toHaveBeenCalled();
  });

  it("commits cleanup exactly once after navigation succeeds", async () => {
    const commitLocalState = vi.fn();
    await expect(
      commitWorkspaceModeChange(
        "image",
        "book",
        async () => true,
        commitLocalState,
      ),
    ).resolves.toBe(true);
    expect(commitLocalState).toHaveBeenCalledOnce();
    expect(commitLocalState).toHaveBeenCalledWith("book");
  });
});
