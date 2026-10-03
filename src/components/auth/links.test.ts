import { describe, expect, it } from "vitest";
import { readPendingAction } from "./links";

describe("pending authentication intent", () => {
  it("preserves Book intent in a versioned envelope", () => {
    expect(readPendingAction(JSON.stringify({ version: 1, action: { type: "save", input: { legs: [] }, book: true } }))).toEqual({ type: "save", input: { legs: [] }, book: true });
  });
  it.each([null, "bad json", '{"version":2,"action":{"type":"create"}}', '{"version":1,"action":{"type":"unknown"}}', '{"version":1,"action":{"type":"pip","text":4}}'])("refuses unsupported envelopes %s", (raw) => {
    expect(readPendingAction(raw)).toBeNull();
  });
});
