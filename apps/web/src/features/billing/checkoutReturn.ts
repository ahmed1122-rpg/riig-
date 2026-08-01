import type { CheckoutSummary } from "../../lib/api";
import { abortableDelay } from "../../lib/api";

export type CheckoutResolution = "success" | "failure" | "delayed";

interface CheckoutVerificationOptions {
  getCheckout(
    checkoutId: string,
    signal?: AbortSignal,
  ): Promise<CheckoutSummary>;
  signal?: AbortSignal;
  attempts?: number;
  intervalMilliseconds?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export async function waitForCheckoutResolution(
  checkoutId: string,
  options: CheckoutVerificationOptions,
): Promise<CheckoutResolution> {
  const attempts = Math.max(1, options.attempts ?? 10);
  const intervalMilliseconds = Math.max(
    0,
    options.intervalMilliseconds ?? 750,
  );
  const wait = options.wait ?? abortableDelay;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const checkout = await options.getCheckout(checkoutId, options.signal);
    const resolution = classifyCheckoutStatus(checkout.status);
    if (resolution) return resolution;
    if (attempt < attempts - 1) {
      await wait(intervalMilliseconds, options.signal);
    }
  }

  return "delayed";
}

export function classifyCheckoutStatus(
  status: CheckoutSummary["status"],
): Exclude<CheckoutResolution, "delayed"> | null {
  if (status === "paid") return "success";
  if (status === "failed" || status === "cancelled") return "failure";
  return null;
}
