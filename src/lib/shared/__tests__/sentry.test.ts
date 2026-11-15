import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubText } from "../sentry";

const LINK_KEY = "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4";

describe("scrubText", () => {
  it("strips the link key from an absolute share URL", () => {
    expect(scrubText(`https://wisp.example/s/abc123#${LINK_KEY}`)).toBe(
      "https://wisp.example/s/abc123",
    );
  });

  it("strips signed-URL tokens from the query string", () => {
    expect(
      scrubText("GET https://x.supabase.co/storage/v1/object/sign/wisp/a.bin?token=eyJhbGciOi failed"),
    ).toBe("GET https://x.supabase.co/storage/v1/object/sign/wisp/a.bin failed");
  });

  it("redacts a key-length fragment on a relative path", () => {
    expect(scrubText(`navigated to /manage/abc123#${LINK_KEY}`)).toBe(
      "navigated to /manage/abc123#[redacted]",
    );
  });

  it("leaves short fragments and plain text alone", () => {
    expect(scrubText("color #f0f1ee at /docs#setup")).toBe("color #f0f1ee at /docs#setup");
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs navigation and fetch URLs", () => {
    const crumb = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/", to: `/s/abc123#${LINK_KEY}`, url: `https://wisp.example/api/x?y=1` },
    });
    expect(crumb.data).toEqual({ from: "/", to: "/s/abc123#[redacted]", url: "https://wisp.example/api/x" });
  });
});

describe("scrubEvent", () => {
  it("removes identity, bodies, cookies and all headers but the user agent", () => {
    const event = scrubEvent({
      type: undefined,
      user: { ip_address: "203.0.113.9", email: "a@example.com" },
      request: {
        url: `https://wisp.example/manage/abc123?x=1#${LINK_KEY}`,
        cookies: { __session: "s" },
        data: { password: "hunter2" },
        query_string: "x=1",
        headers: { "User-Agent": "Safari", "x-management-token": LINK_KEY, cookie: "__session=s" },
      },
      exception: { values: [{ type: "Error", value: `decrypt failed for /s/abc123#${LINK_KEY}` }] },
      breadcrumbs: [{ category: "fetch", data: { url: `https://wisp.example/s/abc123#${LINK_KEY}` } }],
    } as ErrorEvent);

    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({
      url: "https://wisp.example/manage/abc123",
      headers: { "User-Agent": "Safari" },
    });
    expect(JSON.stringify(event)).not.toContain(LINK_KEY);
    expect(JSON.stringify(event)).not.toContain("hunter2");
  });
});
