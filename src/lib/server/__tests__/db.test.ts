import { describe, expect, it } from "vitest";

import { fromPgBytea, toPgBytea } from "../db/client";

describe("bytea conversion", () => {
  it("round-trips base64url through PostgREST hex", () => {
    const original = Buffer.from([0, 1, 2, 250, 251, 255]).toString("base64url");
    expect(fromPgBytea(toPgBytea(original))).toBe(original);
  });

  it("passes null through and rejects unexpected encodings", () => {
    expect(fromPgBytea(null)).toBeNull();
    expect(() => fromPgBytea("deadbeef")).toThrow();
  });
});
