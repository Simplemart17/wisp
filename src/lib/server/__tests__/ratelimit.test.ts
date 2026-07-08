import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rateLimitMemory } from "../ratelimit";

describe("rateLimitMemory", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("blocks once the window budget is spent", () => {
    expect(rateLimitMemory("rl-a", 2, 1000)).toBe(true);
    expect(rateLimitMemory("rl-a", 2, 1000)).toBe(true);
    expect(rateLimitMemory("rl-a", 2, 1000)).toBe(false);
  });

  it("frees budget as timestamps slide out of the window", () => {
    expect(rateLimitMemory("rl-b", 2, 1000)).toBe(true);
    vi.advanceTimersByTime(600);
    expect(rateLimitMemory("rl-b", 2, 1000)).toBe(true);
    expect(rateLimitMemory("rl-b", 2, 1000)).toBe(false);
    // First hit (t=0) leaves the 1s window at t>1000; one slot opens.
    vi.advanceTimersByTime(500);
    expect(rateLimitMemory("rl-b", 2, 1000)).toBe(true);
    expect(rateLimitMemory("rl-b", 2, 1000)).toBe(false);
  });

  it("a denied call does not consume budget", () => {
    expect(rateLimitMemory("rl-c", 1, 1000)).toBe(true);
    expect(rateLimitMemory("rl-c", 1, 1000)).toBe(false);
    vi.advanceTimersByTime(1001); // only the single allowed hit had to expire
    expect(rateLimitMemory("rl-c", 1, 1000)).toBe(true);
  });
});
