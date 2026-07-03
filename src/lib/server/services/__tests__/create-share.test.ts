import { beforeEach, describe, expect, it, vi } from "vitest";

// The repository seam lets us unit-test the orchestration with a fake DB —
// impossible when routes called supabase-js directly.
vi.mock("../../db/shares", () => ({
  insertShare: vi.fn(async () => {}),
  insertChildShares: vi.fn(async () => {}),
  insertRecipients: vi.fn(async () => {}),
  deleteShare: vi.fn(async () => {}),
}));
vi.mock("../../db/storage", () => ({
  removeBlobs: vi.fn(async () => {}),
}));

import * as sharesDb from "../../db/shares";
import * as storage from "../../db/storage";
import type { ValidatedCreateShare } from "../../policy";
import { createShare } from "../create-share";

function input(overrides: Partial<ValidatedCreateShare> = {}): ValidatedCreateShare {
  return {
    ciphertextRef: "blobs/aaaaaaaaaaaaaaaaaaaaaaaa.bin",
    encryptedMetadata: "AAAA",
    wrappedCek: null,
    kdfSalt: null,
    kdfParams: null,
    policy: {
      v: 1,
      expiresIn: "7d",
      maxViews: 3,
      password: false,
      requireIdentity: false,
      requireSignature: false,
      viewOnly: false,
      watermark: false,
      notifyEmail: null,
    },
    recipients: [],
    expiresAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createShare", () => {
  it("persists an anonymous share and returns a one-time management token", async () => {
    const result = await createShare(input(), null);
    expect(sharesDb.insertShare).toHaveBeenCalledOnce();
    expect(sharesDb.insertChildShares).not.toHaveBeenCalled();
    expect(result.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(result.managementToken.length).toBeGreaterThanOrEqual(40);
    expect(result.recipientLinks).toEqual([]);
  });

  it("mints one child link + recipient per email for identity shares", async () => {
    const result = await createShare(
      input({
        policy: { ...input().policy, requireIdentity: true },
        recipients: ["jane@x.com", "sam@y.org"],
      }),
      "user_123",
    );
    expect(sharesDb.insertChildShares).toHaveBeenCalledOnce();
    expect(sharesDb.insertRecipients).toHaveBeenCalledOnce();
    expect(result.recipientLinks.map((r) => r.email)).toEqual(["jane@x.com", "sam@y.org"]);
    expect(result.recipientLinks.every((r) => /^[A-Za-z0-9_-]{16}$/.test(r.linkId))).toBe(true);
  });

  it("rolls back (deletes blob + parent) when a later insert fails", async () => {
    vi.mocked(sharesDb.insertRecipients).mockRejectedValueOnce(new Error("recipients boom"));
    await expect(
      createShare(
        input({
          policy: { ...input().policy, requireIdentity: true },
          recipients: ["jane@x.com"],
        }),
        null,
      ),
    ).rejects.toThrow("recipients boom");

    expect(storage.removeBlobs).toHaveBeenCalledWith(["blobs/aaaaaaaaaaaaaaaaaaaaaaaa.bin"]);
    expect(sharesDb.deleteShare).toHaveBeenCalledOnce();
  });
});
