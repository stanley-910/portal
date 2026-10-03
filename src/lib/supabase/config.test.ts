import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSupabaseConfig, supabaseConfig, supabaseConfigured } from "./config";

describe("parseSupabaseConfig", () => {
  it("returns null when either var is missing", () => {
    expect(parseSupabaseConfig(undefined, undefined)).toBeNull();
    expect(parseSupabaseConfig("https://x.supabase.co", undefined)).toBeNull();
    expect(parseSupabaseConfig(undefined, "sb_publishable_x")).toBeNull();
  });

  it("treats blank strings as missing", () => {
    expect(parseSupabaseConfig("", "sb_publishable_x")).toBeNull();
    expect(parseSupabaseConfig("https://x.supabase.co", "   ")).toBeNull();
  });

  it("returns trimmed values when both are present", () => {
    expect(parseSupabaseConfig(" https://x.supabase.co ", "sb_publishable_x\n")).toEqual({
      url: "https://x.supabase.co",
      key: "sb_publishable_x",
    });
  });
});

describe("supabaseConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the two public vars", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    expect(supabaseConfig()).toEqual({ url: "https://x.supabase.co", key: "sb_publishable_x" });
    expect(supabaseConfigured()).toBe(true);
  });

  it("is off when the vars are blank", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(supabaseConfig()).toBeNull();
    expect(supabaseConfigured()).toBe(false);
  });
});
