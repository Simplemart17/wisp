import { describe, expect, it } from "vitest";

import { ApiError } from "../http";
import { parseCreateShare } from "../policy";

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64url");

function validBody(): Record<string, unknown> {
  return {
    ciphertextRef: `blobs/${"a".repeat(24)}.bin`,
    encryptedMetadata: b64(64),
    policy: { expiresIn: "7d", maxViews: 3 },
  };
}

function withPassword(): Record<string, unknown> {
  return {
    ...validBody(),
    wrappedCek: b64(60),
    kdfSalt: b64(16),
    kdfParams: {
      algorithm: "argon2id",
      version: 19,
      iterations: 3,
      memorySize: 65536,
      parallelism: 4,
      hashLength: 32,
    },
  };
}

describe("parseCreateShare", () => {
  it("accepts a minimal passwordless share", () => {
    const parsed = parseCreateShare(validBody());
    expect(parsed.policy).toEqual({
      expiresIn: "7d",
      maxViews: 3,
      password: false,
      requireIdentity: false,
      requireSignature: false,
      viewOnly: false,
      watermark: false,
      notifyEmail: null,
    });
    expect(parsed.wrappedCek).toBeNull();
    expect(parsed.recipients).toEqual([]);
    expect(parsed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts a password share and flags the policy", () => {
    const parsed = parseCreateShare(withPassword());
    expect(parsed.policy.password).toBe(true);
    expect(parsed.kdfParams).toMatchObject({ algorithm: "argon2id" });
  });

  it("treats missing maxViews as unlimited", () => {
    const body = validBody();
    (body.policy as Record<string, unknown>).maxViews = undefined;
    expect(parseCreateShare(body).policy.maxViews).toBeNull();
  });

  it("normalizes and deduplicates identity recipients", () => {
    const body = {
      ...validBody(),
      policy: { expiresIn: "7d", maxViews: 1, requireIdentity: true },
      recipients: ["Jane@X.com ", "jane@x.com", "sam@y.org"],
    };
    const parsed = parseCreateShare(body);
    expect(parsed.policy.requireIdentity).toBe(true);
    expect(parsed.recipients).toEqual(["jane@x.com", "sam@y.org"]);
  });

  it("accepts view-only, watermark and notify options", () => {
    const body = {
      ...validBody(),
      policy: {
        expiresIn: "24h",
        maxViews: null,
        viewOnly: true,
        watermark: true,
        notifyEmail: "Sender@Me.io",
      },
    };
    const parsed = parseCreateShare(body);
    expect(parsed.policy).toMatchObject({
      viewOnly: true,
      watermark: true,
      notifyEmail: "sender@me.io",
    });
  });

  it.each([
    ["signature without identity", { policy: { expiresIn: "7d", requireSignature: true } }],
    ["identity without recipients", { policy: { expiresIn: "7d", requireIdentity: true } }],
    ["identity with a bad email", {
      policy: { expiresIn: "7d", requireIdentity: true },
      recipients: ["not-an-email"],
    }],
    ["too many recipients", {
      policy: { expiresIn: "7d", requireIdentity: true },
      recipients: Array.from({ length: 21 }, (_, i) => `user${i}@x.com`),
    }],
    ["bad notify email", { policy: { expiresIn: "7d", notifyEmail: "nope" } }],
    ["non-boolean viewOnly", { policy: { expiresIn: "7d", viewOnly: "yes" } }],
    ["foreign blob path", { ciphertextRef: "../../etc/passwd" }],
    ["wrong-length wrappedCek", { ...withPassword(), wrappedCek: b64(59) }],
    ["wrap without salt+params", { ...validBody(), wrappedCek: b64(60) }],
    ["oversized metadata", { encryptedMetadata: b64(5000) }],
    ["unknown expiry", { policy: { expiresIn: "90d", maxViews: null } }],
    ["zero maxViews", { policy: { expiresIn: "7d", maxViews: 0 } }],
    ["huge maxViews", { policy: { expiresIn: "7d", maxViews: 1000 } }],
    ["hostile kdf memory", (() => {
      const body = withPassword();
      (body.kdfParams as Record<string, unknown>).memorySize = 1 << 22;
      return body;
    })()],
  ])("rejects %s with a 400", (_label, patch) => {
    const body = { ...validBody(), ...(patch as Record<string, unknown>) };
    try {
      parseCreateShare(body);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });
});
