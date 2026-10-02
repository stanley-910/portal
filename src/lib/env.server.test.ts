import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.server";

describe("parseEnv", () => {
  it("accepts an empty environment", () => {
    expect(parseEnv({})).toEqual({});
  });

  it("treats empty strings as unset", () => {
    expect(parseEnv({ TDX_CLIENT_ID: "", TDX_CLIENT_SECRET: "  " }).TDX_CLIENT_ID).toBeUndefined();
  });

  it("keeps set values and drops unknown vars", () => {
    const env = parseEnv({ DATA_GO_KR_SERVICE_KEY: "a+b/c=", PATH: "/bin" });
    expect(env.DATA_GO_KR_SERVICE_KEY).toBe("a+b/c=");
    expect(env).not.toHaveProperty("PATH");
  });
});
