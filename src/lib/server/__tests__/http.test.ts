/**
 * clientIp is security-critical: rate-limit keys and audit IP hashes both key
 * off it, and X-Forwarded-For is attacker-influenced. These tests pin the
 * trusted-proxy-depth arithmetic so a refactor can't silently make the
 * spoofable leftmost entry win.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiError, clientIp, enforceRateLimit, errorResponse } from "../http";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://test.local/api", { headers });
}

const ENV_KEYS = ["WISP_TRUSTED_PROXY_DEPTH", "SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Force the in-memory limiter path — no database in unit tests.
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("clientIp", () => {
  it("default depth 1: the rightmost XFF hop (appended by the trusted proxy) wins", () => {
    delete process.env.WISP_TRUSTED_PROXY_DEPTH;
    expect(clientIp(reqWith({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("spoofed left entries never win at depth 1", () => {
    process.env.WISP_TRUSTED_PROXY_DEPTH = "1";
    expect(
      clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("depth 2: skips our own proxy hop and reads the client just left of it", () => {
    process.env.WISP_TRUSTED_PROXY_DEPTH = "2";
    expect(clientIp(reqWith({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9",
    );
  });

  it("depth 0: XFF is ignored entirely (no proxy in front)", () => {
    process.env.WISP_TRUSTED_PROXY_DEPTH = "0";
    expect(
      clientIp(reqWith({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.2" })),
    ).toBe("198.51.100.2");
  });

  it("clamps to the leftmost hop when the chain is shorter than the depth", () => {
    process.env.WISP_TRUSTED_PROXY_DEPTH = "5";
    expect(clientIp(reqWith({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    delete process.env.WISP_TRUSTED_PROXY_DEPTH;
    expect(clientIp(reqWith({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(reqWith({}))).toBe("unknown");
  });

  it("handles whitespace and empty XFF entries", () => {
    process.env.WISP_TRUSTED_PROXY_DEPTH = "1";
    expect(clientIp(reqWith({ "x-forwarded-for": " 6.6.6.6 ,  , 203.0.113.9 " }))).toBe(
      "203.0.113.9",
    );
  });
});

describe("enforceRateLimit (memory fallback)", () => {
  it("allows up to the cap, then throws a uniform 429", async () => {
    const req = reqWith({ "x-real-ip": "192.0.2.77" });
    for (let i = 0; i < 3; i++) {
      await expect(enforceRateLimit(req, "test-scope-a", 3, 60_000)).resolves.toBeUndefined();
    }
    await expect(enforceRateLimit(req, "test-scope-a", 3, 60_000)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("buckets are keyed per scope and per client", async () => {
    const alice = reqWith({ "x-real-ip": "192.0.2.1" });
    const bob = reqWith({ "x-real-ip": "192.0.2.2" });
    await enforceRateLimit(alice, "test-scope-b", 1, 60_000);
    // Same scope, different client — unaffected.
    await expect(enforceRateLimit(bob, "test-scope-b", 1, 60_000)).resolves.toBeUndefined();
    // Same client, different scope — unaffected.
    await expect(enforceRateLimit(alice, "test-scope-c", 1, 60_000)).resolves.toBeUndefined();
  });
});

describe("errorResponse", () => {
  it("maps ApiError to its status and kind", async () => {
    const res = errorResponse(new ApiError(410, "Gone away", "expired"));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Gone away", kind: "expired" });
  });

  it("maps unknown errors to an opaque 500", async () => {
    const res = errorResponse(new Error("secret internals: db password"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error", kind: null });
  });
});
