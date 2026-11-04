import { describe, expect, it } from "vitest";
import { getLocalHttpDenial, LOCAL_HTTP_TRUST } from "../server/classification/localHttpTrust";

describe("local HTTP service trust policy", () => {
  it("starts Laya and OpenCode unverified and denies both", () => {
    expect(LOCAL_HTTP_TRUST).toEqual({
      LAYA_HTTP: "UNVERIFIED",
      OPENCODE_HTTP: "UNVERIFIED",
    });
    expect(getLocalHttpDenial("LAYA_HTTP")).toMatchObject({
      trust: "UNVERIFIED",
      decision: "DENY",
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    });
    expect(getLocalHttpDenial("OPENCODE_HTTP")).toMatchObject({
      trust: "UNVERIFIED",
      decision: "DENY",
      code: "LOCAL_SERVICE_IDENTITY_UNVERIFIED",
    });
  });
});
