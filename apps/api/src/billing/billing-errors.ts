export class BillingDomainError extends Error {
  constructor(
    readonly code:
      | "PAYMENT_PROVIDER_UNAVAILABLE"
      | "CHECKOUT_NOT_FOUND"
      | "CHECKOUT_NOT_COMPLETABLE"
      | "IDEMPOTENCY_CONFLICT"
      | "WEBHOOK_SIGNATURE_INVALID"
      | "WEBHOOK_EVENT_INVALID"
      | "SUBSCRIPTION_NOT_MANAGEABLE",
    message: string,
  ) {
    super(message);
  }
}
