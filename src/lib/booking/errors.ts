// Why a booking step stopped, in words the leg can show. Every provider failure maps onto one of these so the UI
// never prints an upstream message, and the flow can decide what to roll back from the code alone.

export type BookingErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_ALLOWED"
  | "NOT_FOUND"
  | "WRONG_STATE"
  | "OFFER_GONE"
  | "PRICE_CHANGED"
  | "ORDER_FAILED"
  | "PAYMENT_FAILED"
  | "UPSTREAM_ERROR";

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message?: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "BookingError";
  }
}

export const isBookingError = (e: unknown): e is BookingError => e instanceof BookingError;
