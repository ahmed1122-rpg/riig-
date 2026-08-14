import { describe, expect, it, vi } from "vitest";
import {
  ApplicationDrainingError,
  OperationalReadiness,
} from "./operational-readiness.js";

describe("OperationalReadiness", () => {
  it("checks every dependency while the instance accepts traffic", async () => {
    const database = vi.fn().mockResolvedValue(undefined);
    const storage = vi.fn().mockResolvedValue(undefined);
    const readiness = new OperationalReadiness({ database, storage });

    await readiness.assertReady();

    expect(database).toHaveBeenCalledOnce();
    expect(storage).toHaveBeenCalledOnce();
  });

  it("fails closed as soon as draining begins", async () => {
    const dependency = vi.fn().mockResolvedValue(undefined);
    const readiness = new OperationalReadiness({ dependency });
    readiness.beginDrain();

    await expect(readiness.assertReady()).rejects.toBeInstanceOf(
      ApplicationDrainingError,
    );
    expect(dependency).not.toHaveBeenCalled();
  });

  it("does not return ready if draining starts during a dependency probe", async () => {
    let finishProbe: (() => void) | undefined;
    const readiness = new OperationalReadiness({
      dependency: () =>
        new Promise<void>((resolve) => {
          finishProbe = resolve;
        }),
    });
    const probe = readiness.assertReady();
    await Promise.resolve();
    readiness.beginDrain();
    finishProbe?.();

    await expect(probe).rejects.toBeInstanceOf(ApplicationDrainingError);
  });
});
