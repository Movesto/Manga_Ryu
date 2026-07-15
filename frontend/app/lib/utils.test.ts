import { describe, expect, it, vi, afterEach } from "vitest";
import { relativeTime, chNum } from "./utils";

describe("relativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("returns empty string for falsy input", () => {
    expect(relativeTime(0)).toBe("");
  });

  it("expects milliseconds, not seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it.each([
    [90 * 60 * 1000, "1h ago"],
    [3 * 24 * 3600 * 1000, "3d ago"],
    [2 * 7 * 24 * 3600 * 1000, "2w ago"],
    [40 * 24 * 3600 * 1000, "1 mo ago"],
    [400 * 24 * 3600 * 1000, "1 yr ago"],
  ])("formats an offset of %d ms as %s", (offset, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    expect(relativeTime(Date.now() - offset)).toBe(expected);
  });
});

describe("chNum", () => {
  it("drops the decimal for whole numbers", () => {
    expect(chNum(12.0)).toBe("12");
  });

  it("keeps real decimals", () => {
    expect(chNum(12.5)).toBe("12.5");
  });
});
