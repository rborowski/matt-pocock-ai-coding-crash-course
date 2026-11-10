// ─── Analytics constants ───
// Client-safe pieces of the analytics service. UI components import from
// here, never from ~/services/analyticsService: a runtime import of the
// service pulls ~/db, and with it better-sqlite3, into the browser bundle.

export const PLATFORM_FEE_RATE = 0.2;

export const ANALYTICS_RANGES = ["30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Reads a `range` query value, falling back to the 30-day default. */
export function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((r) => r === value) ?? "30d";
}
