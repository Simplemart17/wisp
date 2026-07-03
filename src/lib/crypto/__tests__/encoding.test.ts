import { describe, expect, it } from "vitest";

import { concatBytes, fromBase64Url, randomBytes, toBase64Url } from "../encoding";

describe("base64url", () => {
  it("round-trips byte arrays of every small length", () => {
    for (let length = 0; length <= 66; length++) {
      const bytes = randomBytes(length);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it("produces only URL-safe characters and no padding", () => {
    // 0xfb 0xef 0xbe encodes to "++++" / "----" territory in the two alphabets
    const encoded = toBase64Url(new Uint8Array([0xfb, 0xef, 0xbe, 0xff, 0xfe]));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("=");
  });

  it("matches a known vector", () => {
    expect(toBase64Url(new Uint8Array([104, 101, 108, 108, 111]))).toBe("aGVsbG8");
    expect(fromBase64Url("aGVsbG8")).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  it("rejects strings with non-base64url characters", () => {
    expect(() => fromBase64Url("abc+/=")).toThrow();
    expect(() => fromBase64Url("abc def")).toThrow();
  });
});

describe("concatBytes", () => {
  it("concatenates in order, tolerating empty arrays", () => {
    const out = concatBytes(
      new Uint8Array([1, 2]),
      new Uint8Array([]),
      new Uint8Array([3]),
    );
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });
});
