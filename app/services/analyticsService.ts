import { and, count, eq, gt, gte, isNotNull, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "~/db";
import {
  getCourseRatingSummaries,
  type CourseRatingSummary,
} from "~/services/courseRatingService";
import {
  coupons,
  courses,
  CourseStatus,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
} from "~/db/schema";

// ─── Analytics Service ───
// Instructor-facing analytics. All money is USD cents. "now" is passed in so
// that range windows are deterministic.
// Uses positional parameters (project convention).

export const PLATFORM_FEE_RATE = 0.2;

export const ANALYTICS_RANGES = ["30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Reads a `range` query value, falling back to the 30-day default. */
export function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((r) => r === value) ?? "30d";
}

export type HeadlineCards = {
  grossCents: number;
  earningsCents: number;
  buyers: number;
  students: number;
  seatsSold: number;
  seatsClaimed: number;
  /** Share of the cohort who completed their course, 0–1. Null if the cohort is empty. */
  strictCompletionRate: number | null;
  /** Mean of each cohort student's completed / total lessons, 0–1. Null if the cohort is empty. */
  averageProgress: number | null;
};

/** Change against the previous period of the same length. Null for "all". */
export type PeriodComparison = {
  previousGrossCents: number;
  previousEarningsCents: number;
  /** Null when the previous period had no revenue. */
  revenueChangePct: number | null;
  previousStudents: number;
  /** Null when the previous period had no enrollments. */
  studentsChangePct: number | null;
};

/** One in-scope course's figures within the range. */
export type CourseRow = {
  courseId: number;
  title: string;
  grossCents: number;
  earningsCents: number;
  /** Enrollments within the range — the course's cohort. */
  enrollments: number;
  /** Null if the course's cohort is empty. */
  strictCompletionRate: number | null;
  /** Null if the course's cohort is empty. */
  averageProgress: number | null;
  /** All-time rating summary. */
  rating: CourseRatingSummary;
};

/** Gross revenue for one buyer country. A null country was not recorded. */
export type CountryRevenue = { country: string | null; grossCents: number };

export type InstructorAnalytics = {
  range: AnalyticsRange;
  cards: HeadlineCards;
  comparison: PeriodComparison | null;
  courses: CourseRow[];
  /** Largest first. */
  revenueByCountry: CountryRevenue[];
};

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = {
  "30d": 30,
  "90d": 90,
};

/**
 * An ISO-timestamp window. The start is inclusive; a null start means "since
 * the beginning". The current window includes "now"; the previous window
 * excludes its end, which is the current window's start, so a row on the
 * boundary is counted once.
 */
type DateWindow = { start: string | null; end: string; endInclusive: boolean };

function currentWindow(range: AnalyticsRange, now: Date): DateWindow {
  const end = now.toISOString();
  if (range === "all") return { start: null, end, endInclusive: true };
  const start = new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS);
  return { start: start.toISOString(), end, endInclusive: true };
}

function previousWindow(range: Exclude<AnalyticsRange, "all">, now: Date): DateWindow {
  const length = RANGE_DAYS[range] * DAY_MS;
  return {
    start: new Date(now.getTime() - 2 * length).toISOString(),
    end: new Date(now.getTime() - length).toISOString(),
    endInclusive: false,
  };
}

function withinWindow(
  column: typeof purchases.createdAt | typeof enrollments.enrolledAt,
  window: DateWindow
) {
  return and(
    window.start === null ? undefined : gte(column, window.start),
    window.endInclusive ? lte(column, window.end) : lt(column, window.end)
  );
}

function percentChange(previous: number, current: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function completionMetrics(
  cohort: { completed: boolean; totalLessons: number; completedLessons: number }[]
) {
  if (cohort.length === 0) {
    return { strictCompletionRate: null, averageProgress: null };
  }
  const completed = cohort.filter((e) => e.completed).length;
  const progressSum = cohort.reduce(
    (sum, e) => sum + (e.totalLessons === 0 ? 0 : e.completedLessons / e.totalLessons),
    0
  );
  return {
    strictCompletionRate: completed / cohort.length,
    averageProgress: progressSum / cohort.length,
  };
}

function sumGross(rows: { amountPaid: number }[]) {
  return rows.reduce((sum, p) => sum + p.amountPaid, 0);
}

/** Earnings after the platform fee, applied once to the summed gross. */
function earningsFor(grossCents: number) {
  return Math.round(grossCents * (1 - PLATFORM_FEE_RATE));
}

/** Published and archived courses, optionally limited to one instructor. */
function courseScope(instructorId: number | null): SQL | undefined {
  return and(
    ne(courses.status, CourseStatus.Draft),
    instructorId === null ? undefined : eq(courses.instructorId, instructorId)
  );
}

/**
 * In-scope paid purchases in the window, with their seats. The $0 purchase
 * recorded for a free-course enrollment is left out: it adds no revenue and
 * its student is not a buyer. A team purchase has one
 * seat per generated coupon, claimed once redeemed. An individual purchase has
 * no coupons and counts as one claimed seat.
 */
function getPurchases(instructorId: number | null, window: DateWindow) {
  const rows = db
    .select({
      userId: purchases.userId,
      courseId: purchases.courseId,
      country: purchases.country,
      amountPaid: purchases.amountPaid,
      coupons: count(coupons.id),
      redeemedCoupons: count(coupons.redeemedByUserId),
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(coupons, eq(coupons.purchaseId, purchases.id))
    .where(
      and(
        courseScope(instructorId),
        withinWindow(purchases.createdAt, window),
        gt(purchases.amountPaid, 0)
      )
    )
    .groupBy(purchases.id)
    .all();

  return rows.map(({ coupons, redeemedCoupons, ...row }) => ({
    ...row,
    seats: coupons === 0 ? 1 : coupons,
    seatsClaimed: coupons === 0 ? 1 : redeemedCoupons,
  }));
}

/**
 * In-scope enrollments in the window — the cohort — with each student's
 * completed lessons in that course and the course's total lessons, as of today.
 */
function getEnrollments(instructorId: number | null, window: DateWindow) {
  const totalLessons = db
    .select({ n: count() })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, enrollments.courseId));

  const completedLessons = db
    .select({ n: count() })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(lessonProgress.userId, enrollments.userId),
        eq(modules.courseId, enrollments.courseId),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    );

  return db
    .select({
      courseId: enrollments.courseId,
      completed: sql<boolean>`${isNotNull(enrollments.completedAt)}`.mapWith(Boolean),
      totalLessons: sql<number>`(${totalLessons})`.mapWith(Number),
      completedLessons: sql<number>`(${completedLessons})`.mapWith(Number),
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(and(courseScope(instructorId), withinWindow(enrollments.enrolledAt, window)))
    .all();
}

/** In-scope courses, oldest first. */
function getCourses(instructorId: number | null) {
  return db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(courseScope(instructorId))
    .orderBy(courses.id)
    .all();
}

function courseRows(
  instructorId: number | null,
  purchaseRows: ReturnType<typeof getPurchases>,
  enrollmentRows: ReturnType<typeof getEnrollments>
): CourseRow[] {
  const scoped = getCourses(instructorId);
  const ratings = getCourseRatingSummaries(scoped.map((c) => c.id));

  return scoped.map((course) => {
    const grossCents = sumGross(purchaseRows.filter((p) => p.courseId === course.id));
    const cohort = enrollmentRows.filter((e) => e.courseId === course.id);
    return {
      courseId: course.id,
      title: course.title,
      grossCents,
      earningsCents: earningsFor(grossCents),
      enrollments: cohort.length,
      ...completionMetrics(cohort),
      rating: ratings.get(course.id)!,
    };
  });
}

function revenueByCountry(purchaseRows: ReturnType<typeof getPurchases>): CountryRevenue[] {
  const totals = new Map<string | null, number>();
  for (const p of purchaseRows) {
    totals.set(p.country, (totals.get(p.country) ?? 0) + p.amountPaid);
  }
  return [...totals]
    .map(([country, grossCents]) => ({ country, grossCents }))
    .sort((a, b) => b.grossCents - a.grossCents);
}

export function getInstructorAnalytics(
  instructorId: number | null,
  range: AnalyticsRange,
  now: Date
): InstructorAnalytics {
  const window = currentWindow(range, now);
  const purchaseRows = getPurchases(instructorId, window);
  const enrollmentRows = getEnrollments(instructorId, window);

  const grossCents = sumGross(purchaseRows);
  const students = enrollmentRows.length;

  let comparison: PeriodComparison | null = null;
  if (range !== "all") {
    const previous = previousWindow(range, now);
    const previousGrossCents = sumGross(getPurchases(instructorId, previous));
    const previousStudents = getEnrollments(instructorId, previous).length;
    comparison = {
      previousGrossCents,
      previousEarningsCents: earningsFor(previousGrossCents),
      revenueChangePct: percentChange(previousGrossCents, grossCents),
      previousStudents,
      studentsChangePct: percentChange(previousStudents, students),
    };
  }

  return {
    range,
    cards: {
      grossCents,
      earningsCents: earningsFor(grossCents),
      buyers: new Set(purchaseRows.map((p) => p.userId)).size,
      students,
      seatsSold: purchaseRows.reduce((sum, p) => sum + p.seats, 0),
      seatsClaimed: purchaseRows.reduce((sum, p) => sum + p.seatsClaimed, 0),
      ...completionMetrics(enrollmentRows),
    },
    comparison,
    courses: courseRows(instructorId, purchaseRows, enrollmentRows),
    revenueByCountry: revenueByCountry(purchaseRows),
  };
}
