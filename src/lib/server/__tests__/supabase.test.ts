import { describe, expect, it } from "vitest";

import { bytesToPgHex, pgHexToBase64Url } from "../supabase";

describe("bytea conversion", () => {
  it("round-trips base64url through PostgREST hex", () => {
    const original = Buffer.from([0, 1, 2, 250, 251, 255]).toString("base64url");
    expect(pgHexToBase64Url(bytesToPgHex(original))).toBe(original);
  });

  it("passes null through and rejects unexpected encodings", () => {
    expect(pgHexToBase64Url(null)).toBeNull();
    expect(() => pgHexToBase64Url("deadbeef")).toThrow();
  });
});
