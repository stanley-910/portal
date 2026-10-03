import { beforeEach, describe, expect, it, vi } from "vitest";

// The scheduled sweep: rooms come from the store's active list, not from anyone opening a trip.
const { read, mutate, cancelOrder, cancelPayment } = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn(), cancelOrder: vi.fn(), cancelPayment: vi.fn() }));
vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => ({ getStorageDocument: read, mutateStorage: mutate }) }));
vi.mock("./duffel", () => ({ cancelOrder, getOffer: vi.fn(), getOrder: vi.fn(), createOrder: vi.fn(), payOrder: vi.fn(), searchAgain: vi.fn() }));
vi.mock("./stripe", async (orig) => ({ ...(await orig<typeof import("./stripe")>()), cancelPayment }));
import { sweepBookings } from "./flow";
import { bookingStore } from "./store";

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 60 * 60_000).toISOString();
const booking = (status: "details" | "paying" | "booked", deadline: string | null, orderId?: string) => ({ status, deadline, orderId, mode: "group", seats: { a: { share: { amount: 1, currency: "HKD" }, details: true, paid: false } } });

beforeEach(async () => {
  const store = bookingStore();
  for (const { roomId, legId } of await store.listActive()) await store.clearActive(roomId, legId);
  vi.clearAllMocks();
  mutate.mockResolvedValue(undefined);
  cancelOrder.mockResolvedValue(undefined);
});

describe("sweepBookings", () => {
  it("keeps bookings tracked when reading a room temporarily fails", async () => {
    const store = bookingStore();
    await store.markActive("trip:retry", "leg");
    read.mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }));
    expect(await sweepBookings()).toEqual({ rooms: 1, legs: 1, expired: 0 });
    expect(await store.listActive()).toEqual([{ roomId: "trip:retry", legId: "leg" }]);
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("rolls back legs past their deadline and forgets booked or missing ones", async () => {
    const store = bookingStore();
    await store.markActive("trip:one", "late");
    await store.markActive("trip:one", "fine");
    await store.markActive("trip:one", "done");
    await store.markActive("trip:gone", "leg");
    read.mockImplementation(async (roomId: string) => {
      if (roomId === "trip:gone") throw Object.assign(new Error("ROOM_NOT_FOUND"), { status: 404 });
      return { legs: { late: { booking: booking("paying", past, "ord_1") }, fine: { booking: booking("paying", future) }, done: { booking: booking("booked", null) } } };
    });
    expect(await sweepBookings()).toEqual({ rooms: 2, legs: 4, expired: 1 });
    expect(cancelOrder).toHaveBeenCalledWith("ord_1");
    expect(await store.listActive()).toEqual([{ roomId: "trip:one", legId: "fine" }]);
  });
});
