import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Notice, TierChip, formatBytes } from "../bits";

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

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
