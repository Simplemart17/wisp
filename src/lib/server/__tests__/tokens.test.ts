import { describe, expect, it } from "vitest";

import {
  BLOB_PATH_RE,
  generateBlobPath,
  generateManagementToken,
  generateShareId,
  hashIp,
  sha256Base64Url,
  tokenMatchesHash,
} from "../tokens";

describe("identifiers", () => {
  it("share ids are 16 url-safe chars and unique", () => {
    const ids = new Set(Array.from({ length: 100 }, generateShareId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("blob paths match their own validation regex", () => {
    expect(generateBlobPath()).toMatch(BLOB_PATH_RE);
  });
});

describe("management tokens", () => {
  it("verifies a token against its stored hash", () => {
    const token = generateManagementToken();
    expect(tokenMatchesHash(token, sha256Base64Url(token))).toBe(true);
  });

  it("rejects wrong tokens and malformed hashes", () => {
    const token = generateManagementToken();
    expect(tokenMatchesHash(generateManagementToken(), sha256Base64Url(token))).toBe(false);
    expect(tokenMatchesHash(token, "not-a-hash")).toBe(false);
    expect(tokenMatchesHash(token, "")).toBe(false);
  });
});

describe("hashIp", () => {
  it("is deterministic, truncated, and never contains the raw IP", () => {
    const a = hashIp("203.0.113.7");
    expect(hashIp("203.0.113.7")).toBe(a);
    expect(a).toHaveLength(16);
    expect(a).not.toContain("203");
    expect(hashIp("203.0.113.8")).not.toBe(a);
  });
});
