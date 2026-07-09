import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyField, Notice, TierChip, formatBytes } from "../bits";

describe("Notice", () => {
  it("announces errors and warnings via role=alert", () => {
    render(<Notice tone="error">boom</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("uses role=status for info", () => {
    render(<Notice tone="info">fyi</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("fyi");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TierChip", () => {
  it("labels the protection tier", () => {
    render(<TierChip tier="client-honored" />);
    expect(screen.getByText("client-honored")).toBeInTheDocument();
  });
});

describe("CopyField share button", () => {
  // jsdom has no navigator.share; each test installs exactly what it needs.
  afterEach(() => {
    delete (navigator as { share?: unknown }).share;
  });

  it("offers the OS share sheet when supported and opted in", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    render(<CopyField label="share link" value="https://w.example/s/x#k" share />);
    const button = await screen.findByRole("button", { name: "share share link" });
    button.click();
    expect(share).toHaveBeenCalledWith({ url: "https://w.example/s/x#k" });
  });

  it("stays copy-only when the browser lacks Web Share", () => {
    render(<CopyField label="share link" value="https://w.example/s/x#k" share />);
    expect(screen.queryByRole("button", { name: /^share/ })).toBeNull();
    expect(screen.getByRole("button", { name: "copy share link" })).toBeInTheDocument();
  });

  it("never offers sharing without the opt-in — management links stay private", () => {
    Object.defineProperty(navigator, "share", { value: vi.fn(), configurable: true });
    render(<CopyField label="management link" value="https://w.example/manage/x#t" />);
    expect(screen.queryByRole("button", { name: /^share/ })).toBeNull();
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
