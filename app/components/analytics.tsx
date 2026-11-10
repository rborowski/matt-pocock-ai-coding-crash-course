import { Link, useSearchParams } from "react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "~/components/ui/card";
import { cn, formatPrice } from "~/lib/utils";
import {
  ANALYTICS_RANGES,
  PLATFORM_FEE_RATE,
  type AnalyticsRange,
  type CountryRevenue,
  type HeadlineCards,
  type PeriodComparison,
  type TopBuyer,
} from "~/services/analyticsService";

// ─── Analytics UI ───
// Pieces shared by the instructor roll-up and the per-course deep dive.

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export const EARNINGS_LABEL = `Your earnings (${Math.round((1 - PLATFORM_FEE_RATE) * 100)}%)`;

/** formatPrice renders 0 as "Free", which reads wrongly for revenue. */
export function formatMoney(cents: number) {
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

export function formatPercent(fraction: number | null) {
  return fraction === null ? "—" : `${Math.round(fraction * 100)}%`;
}

function ChangeBadge({ changePct, previous }: { changePct: number | null; previous: string }) {
  if (changePct === null) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        No activity in the previous period
      </p>
    );
  }
  const up = changePct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-1 text-xs",
        up ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"
      )}
    >
      <Arrow className="size-3" />
      {up ? "+" : ""}
      {changePct}% vs previous period ({previous})
    </p>
  );
}

function StatCard({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export const HEADER_CELL = "px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground";
export const NUMBER_HEADER_CELL = cn(HEADER_CELL, "text-right");
export const BODY_CELL = "px-4 py-3 text-sm";
export const NUMBER_CELL = cn(BODY_CELL, "text-right");

/** Range switcher. Links keep every other query param (e.g. instructorId). */
export function RangeNav({ range }: { range: AnalyticsRange }) {
  const [searchParams] = useSearchParams();

  function rangeHref(r: AnalyticsRange) {
    const params = new URLSearchParams(searchParams);
    params.set("range", r);
    return `?${params}`;
  }

  return (
    <nav aria-label="Time range" className="inline-flex rounded-md border p-0.5">
      {ANALYTICS_RANGES.map((r) => (
        <Link
          key={r}
          to={rangeHref(r)}
          preventScrollReset
          aria-current={r === range ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1 text-sm",
            r === range
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {RANGE_LABELS[r]}
        </Link>
      ))}
    </nav>
  );
}

export function HeadlineCardGrid({
  cards,
  comparison,
}: {
  cards: HeadlineCards;
  comparison: PeriodComparison | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label={EARNINGS_LABEL} value={formatMoney(cards.earningsCents)}>
        <p className="text-xs text-muted-foreground">
          Gross sales {formatMoney(cards.grossCents)}
        </p>
        {comparison && (
          <ChangeBadge
            changePct={comparison.revenueChangePct}
            previous={formatMoney(comparison.previousEarningsCents)}
          />
        )}
      </StatCard>
      <StatCard label="Students" value={String(cards.students)}>
        {comparison && (
          <ChangeBadge
            changePct={comparison.studentsChangePct}
            previous={String(comparison.previousStudents)}
          />
        )}
      </StatCard>
      <StatCard label="Buyers" value={String(cards.buyers)} />
      <StatCard
        label="Seats sold / claimed"
        value={`${cards.seatsSold} / ${cards.seatsClaimed}`}
      />
      <StatCard
        label="Strict completion rate"
        value={formatPercent(cards.strictCompletionRate)}
      >
        <p className="text-xs text-muted-foreground">
          Students who enrolled in this range and finished
        </p>
      </StatCard>
      <StatCard label="Average progress" value={formatPercent(cards.averageProgress)}>
        <p className="text-xs text-muted-foreground">
          Lessons completed per student, as a share of the course
        </p>
      </StatCard>
    </div>
  );
}

export function RevenueByCountry({ rows }: { rows: CountryRevenue[] }) {
  const maxGrossCents = Math.max(0, ...rows.map((r) => r.grossCents));
  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales in this range.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.country ?? "unknown"} className="grid grid-cols-[5rem_1fr_6rem] items-center gap-3 text-sm">
                <span>{row.country ?? "Unknown"}</span>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${maxGrossCents === 0 ? 0 : (row.grossCents / maxGrossCents) * 100}%` }}
                  />
                </div>
                <span className="text-right tabular-nums">{formatMoney(row.grossCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function TopBuyersTable({ rows }: { rows: TopBuyer[] }) {
  return (
    <Card className="py-0">
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={cn(HEADER_CELL, "text-left")}>Buyer</th>
              <th className={NUMBER_HEADER_CELL}>Total spent</th>
              <th className={NUMBER_HEADER_CELL}>Seats bought</th>
              <th className={NUMBER_HEADER_CELL}>Claimed</th>
              <th className={NUMBER_HEADER_CELL}>Unclaimed</th>
              <th className={cn(HEADER_CELL, "text-left")}>Courses</th>
              <th className={NUMBER_HEADER_CELL}>Last purchase</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={cn(BODY_CELL, "text-center text-muted-foreground")}>
                  No sales in this range.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.userId} className="border-b border-border last:border-0">
                  <td className={BODY_CELL}>
                    <span className="block font-medium">{row.name}</span>
                    <a
                      href={`mailto:${row.email}`}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {row.email}
                    </a>
                  </td>
                  <td className={NUMBER_CELL}>{formatMoney(row.grossCents)}</td>
                  <td className={NUMBER_CELL}>{row.seatsBought}</td>
                  <td className={NUMBER_CELL}>{row.seatsClaimed}</td>
                  <td
                    className={cn(
                      NUMBER_CELL,
                      row.seatsUnclaimed > 0 && "font-medium text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {row.seatsUnclaimed}
                  </td>
                  <td className={BODY_CELL}>{row.courses.map((c) => c.title).join(", ")}</td>
                  <td className={cn(NUMBER_CELL, "whitespace-nowrap")}>
                    {formatDate(row.lastPurchasedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
