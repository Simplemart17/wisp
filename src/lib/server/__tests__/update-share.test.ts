import { describe, expect, it } from "vitest";

import { parseUpdateShare } from "../policy";

const LINK_ID = "abcDEF123-_45678"; // 16 base64url chars

describe("parseUpdateShare", () => {
  it("rejects an empty update", () => {
    expect(() => parseUpdateShare({})).toThrowError(/Nothing to update/);
  });

  it("parses extendExpiry alone", () => {
    expect(parseUpdateShare({ extendExpiry: "24h" })).toEqual({
      extendExpiry: "24h",
      addViews: null,
      linkId: null,
    });
  });

  it("rejects unknown expiry windows", () => {
    expect(() => parseUpdateShare({ extendExpiry: "90d" })).toThrowError(/extendExpiry/);
    expect(() => parseUpdateShare({ extendExpiry: 24 })).toThrowError(/extendExpiry/);
  });

  it("parses addViews alone and with a recipient link", () => {
    expect(parseUpdateShare({ addViews: 5 })).toEqual({
      extendExpiry: null,
      addViews: 5,
      linkId: null,
    });
    expect(parseUpdateShare({ addViews: 100, linkId: LINK_ID })).toEqual({
      extendExpiry: null,
      addViews: 100,
      linkId: LINK_ID,
    });
  });

  it("bounds addViews to integers 1..100", () => {
    for (const bad of [0, -1, 101, 2.5, "5", null]) {
      expect(() => parseUpdateShare({ addViews: bad, extendExpiry: undefined })).toThrowError();
    }
  });

  it("rejects linkId without addViews and malformed link ids", () => {
    expect(() => parseUpdateShare({ extendExpiry: "1h", linkId: LINK_ID })).toThrowError(
      /linkId only applies/,
    );
    expect(() => parseUpdateShare({ addViews: 1, linkId: "short" })).toThrowError(/linkId/);
    expect(() => parseUpdateShare({ addViews: 1, linkId: "has spaces here!" })).toThrowError(
      /linkId/,
    );
  });

  it("allows combining expiry and views in one call", () => {
    expect(parseUpdateShare({ extendExpiry: "7d", addViews: 10 })).toEqual({
      extendExpiry: "7d",
      addViews: 10,
      linkId: null,
    });
  });
});
