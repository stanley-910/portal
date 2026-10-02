import { describe, expect, it, vi } from "vitest";
import { GlobeEngine } from "./engine";
import { D2R, vecOf } from "./vec";

function engine() {
  const onLand = vi.fn();
  const onModeChange = vi.fn();
  const onPreviewChange = vi.fn();
  const globe = new GlobeEngine({} as HTMLElement, {} as HTMLCanvasElement,
    { getContext: () => ({}) } as unknown as HTMLCanvasElement, "", { onLand, onModeChange, onPreviewChange });
  return { globe, onLand, onModeChange, onPreviewChange };
}
const point = (lat: number, lng: number) => vecOf(lat * D2R, lng * D2R);

describe("globe hub preview lifecycle", () => {
  it("starts and lands uncovered trips without requiring an airport", () => {
    const { globe, onModeChange, onLand } = engine();
    globe["takeoff"](point(0, -140));
    expect(onModeChange).toHaveBeenCalledWith("flying", null);
    globe["land"](point(5, -140));
    expect(onLand).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: null }));
    const trip = onLand.mock.calls[0][0];
    expect(trip.origin.lng).toBeCloseTo(-140);
    expect(trip.destination.lat).toBeCloseTo(5);
    expect(trip.distanceKm).toBeGreaterThan(550);
  });
  it("preserves precise click points even when a nearby surface hub is previewed", () => {
    const { globe, onLand } = engine();
    globe["takeoff"](point(22.305, 114.165));
    globe["land"](point(31.23, 121.47));
    const trip = onLand.mock.calls[0][0];
    expect(trip.from.mode).toBe("train");
    expect(trip.origin.lat).toBeCloseTo(22.305);
    expect(trip.destination.lng).toBeCloseTo(121.47);
  });
  it("only publishes preview changes, clearing immediately on pointer leave", () => {
    const { globe, onPreviewChange } = engine();
    const hkg = point(22.308, 113.918);
    globe["updatePreview"](hkg, 0);
    globe["updatePreview"](hkg, 100);
    expect(onPreviewChange).toHaveBeenCalledTimes(1);
    expect(onPreviewChange.mock.calls[0][0].iata).toBe("HKG");
    globe.pointerLeave();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  });
  it("clears moving preview on landing and cancellation", () => {
    const { globe, onPreviewChange } = engine();
    const hkg = point(22.308, 113.918);
    globe["takeoff"](hkg);
    globe["updatePreview"](hkg, 0);
    globe["land"](point(31.23, 121.47));
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    globe["updatePreview"](hkg, 100);
    globe.cancel();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
    expect(globe.getMode()).toBe("idle");
  });
});
