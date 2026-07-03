import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GatePhase } from "../use-share-access";
import { GateForm } from "../gate-form";

function renderGate(gate: Partial<GatePhase>, overrides: Record<string, unknown> = {}) {
  const props = {
    gate: { name: "gate", requiresPassword: false, requiresIdentity: false, otpSent: false, ...gate } as GatePhase,
    email: "",
    setEmail: vi.fn(),
    code: "",
    setCode: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    onSendCode: vi.fn(),
    onReveal: vi.fn(),
    ...overrides,
  };
  render(<GateForm {...props} />);
  return props;
}

describe("GateForm", () => {
  it("shows neither gate for a link-only share and enables reveal", () => {
    renderGate({});
    expect(screen.queryByText("Password")).toBeNull();
    expect(screen.queryByText("Your email")).toBeNull();
    expect(screen.getByRole("button", { name: /decrypt/i })).toBeEnabled();
  });

  it("requires a password before revealing when password-gated", () => {
    renderGate({ requiresPassword: true });
    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decrypt/i })).toBeDisabled();
  });

  it("enables reveal once a password is entered", () => {
    renderGate({ requiresPassword: true }, { password: "hunter2" });
    expect(screen.getByRole("button", { name: /decrypt/i })).toBeEnabled();
  });

  it("gates on a 6-digit code for identity shares, shown only after the code is sent", () => {
    const { rerender } = { rerender: null } as unknown as { rerender: unknown };
    void rerender;
    renderGate({ requiresIdentity: true, otpSent: false });
    expect(screen.getByText("Your email")).toBeInTheDocument();
    expect(screen.queryByText("Verification code")).toBeNull();
    expect(screen.getByRole("button", { name: /decrypt/i })).toBeDisabled();
  });

  it("enables reveal for identity shares with a valid code", () => {
    renderGate({ requiresIdentity: true, otpSent: true }, { code: "123456" });
    expect(screen.getByText("Verification code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decrypt/i })).toBeEnabled();
  });

  it("warns that opening may burn a view before first access", () => {
    renderGate({});
    expect(screen.getByRole("alert")).toHaveTextContent(/limited views/i);
  });
});
