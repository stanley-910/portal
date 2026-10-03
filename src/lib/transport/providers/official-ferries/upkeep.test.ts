import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "scripts/check-ferry-sources.mts";
const folder = "src/lib/transport/providers/official-ferries/";
const run = (...args: string[]) => execFileSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...args], { encoding: "utf8", stdio: "pipe" });

describe("ferry source upkeep", () => {
  it("validates the reviewed offline evidence without any network", () => {
    expect(run("--check", "--as-of", "2026-10-03")).toContain("No live inventory claimed");
    expect(run("--compare", "batamfast", `${folder}fixtures/batamfast.html`)).toContain("matches recorded evidence");
  });
  it("flags stale review dates without mutating the seed", () => {
    const before = readFileSync(`${folder}seed.json`, "utf8");
    expect(() => run("--check", "--as-of", "2026-11-03")).toThrow(/Source review required/);
    expect(readFileSync(`${folder}seed.json`, "utf8")).toBe(before);
  });
  it("flags an operator time change while retaining the last good data", () => {
    const directory = mkdtempSync(join(tmpdir(), "ferry-evidence-"));
    const before = readFileSync(`${folder}seed.json`, "utf8");
    try {
      const changed = readFileSync(`${folder}fixtures/batamfast.html`, "utf8").replace("07:40", "07:55");
      writeFileSync(join(directory, "changed.html"), changed);
      expect(() => run("--compare", "batamfast", join(directory, "changed.html"))).toThrow(/source changed/);
      expect(readFileSync(`${folder}seed.json`, "utf8")).toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
