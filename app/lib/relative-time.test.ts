import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time";

const now = new Date("2026-06-15T12:00:00Z").getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("just now");
  });
  it("formats minutes and hours", () => {
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(2 * HOUR), now)).toBe("2 hours ago");
  });
  it("formats days with numeric auto", () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(3 * DAY), now)).toBe("3 days ago");
  });
  it("formats weeks, months and years", () => {
    expect(formatRelativeTime(ago(14 * DAY), now)).toBe("2 weeks ago");
    expect(formatRelativeTime(ago(60 * DAY), now)).toBe("2 months ago");
    expect(formatRelativeTime(ago(800 * DAY), now)).toBe("2 years ago");
  });
  it("treats slightly future timestamps as just now", () => {
    expect(formatRelativeTime(new Date(now + 5000).toISOString(), now)).toBe(
      "just now"
    );
  });
  it("returns empty string for invalid input", () => {
    expect(formatRelativeTime("nope", now)).toBe("");
  });
});
