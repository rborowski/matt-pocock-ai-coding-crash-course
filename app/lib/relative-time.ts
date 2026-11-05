const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

/**
 * Formats an ISO timestamp relative to `now` ("3 days ago", "yesterday").
 * Anything under a minute is "just now".
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now()
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return "just now";
  for (const [unit, seconds] of UNITS) {
    if (abs >= seconds) {
      return rtf.format(Math.trunc(diffSeconds / seconds), unit);
    }
  }
  return "just now";
}
