import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/instructor";
import { getCoursesByInstructor, getLessonCountForCourse } from "~/services/courseService";
import { getEnrollmentCountForCourse } from "~/services/enrollmentService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById, getUsersByRole } from "~/services/userService";
import { Card, CardContent, CardFooter, CardHeader } from "~/components/ui/card";
import {
  getInstructorAnalytics,
  parseAnalyticsRange,
  ANALYTICS_RANGES,
  PLATFORM_FEE_RATE,
  type AnalyticsRange,
  type CountryRevenue,
  type CourseRow,
  type InstructorAnalytics,
  type TopBuyer,
} from "~/services/analyticsService";
import { cn, formatPrice } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  GraduationCap,
  MessageCircleQuestion,
  Plus,
  Star,
  Users,
} from "lucide-react";
import { CourseImage } from "~/components/course-image";
import { data, isRouteErrorResponse } from "react-router";
import { CourseStatus, UserRole } from "~/db/schema";

export function meta() {
  return [
    { title: "My Courses — Cadence" },
    { name: "description", content: "Manage your courses" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your courses.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)) {
    throw data("Only instructors and admins can access this page.", {
      status: 403,
    });
  }

  const searchParams = new URL(request.url).searchParams;
  const range = parseAnalyticsRange(searchParams.get("range"));

  if (user.role === UserRole.Admin) {
    const instructors = getUsersByRole(UserRole.Instructor)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // An unknown or missing instructorId falls back to "All instructors".
    const requestedId = Number(searchParams.get("instructorId"));
    const selectedInstructorId = instructors.some((i) => i.id === requestedId)
      ? requestedId
      : null;
    return {
      isAdmin: true as const,
      instructors,
      selectedInstructorId,
      courses: [],
      analytics: getInstructorAnalytics(selectedInstructorId, range, new Date()),
    };
  }

  // An instructor always sees their own courses; any instructorId is ignored.
  const analytics = getInstructorAnalytics(currentUserId, range, new Date());

  const instructorCourses = getCoursesByInstructor(currentUserId);

  const coursesWithStats = instructorCourses.map((course) => {
    const lessonCount = getLessonCountForCourse(course.id);
    const enrollmentCount = getEnrollmentCountForCourse(course.id);

    return {
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: course.description,
      status: course.status,
      coverImageUrl: course.coverImageUrl,
      lessonCount,
      enrollmentCount,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    };
  });

  return {
    isAdmin: false as const,
    instructors: [],
    selectedInstructorId: null,
    courses: coursesWithStats,
    analytics,
  };
}

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const EARNINGS_LABEL = `Your earnings (${Math.round((1 - PLATFORM_FEE_RATE) * 100)}%)`;

/** formatPrice renders 0 as "Free", which reads wrongly for revenue. */
function formatMoney(cents: number) {
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

function formatPercent(fraction: number | null) {
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

const HEADER_CELL = "px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground";
const NUMBER_HEADER_CELL = cn(HEADER_CELL, "text-right");
const BODY_CELL = "px-4 py-3 text-sm";
const NUMBER_CELL = cn(BODY_CELL, "text-right");

function CourseTable({ rows, showInstructor }: { rows: CourseRow[]; showInstructor: boolean }) {
  return (
    <Card className="py-0">
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className={cn(HEADER_CELL, "text-left")}>Course</th>
              {showInstructor && <th className={cn(HEADER_CELL, "text-left")}>Instructor</th>}
              <th className={NUMBER_HEADER_CELL}>{EARNINGS_LABEL}</th>
              <th className={NUMBER_HEADER_CELL}>Enrollments</th>
              <th className={NUMBER_HEADER_CELL}>Completion</th>
              <th className={NUMBER_HEADER_CELL}>Avg progress</th>
              <th className={NUMBER_HEADER_CELL}>Rating (all time)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showInstructor ? 7 : 6} className={cn(BODY_CELL, "text-center text-muted-foreground")}>
                  No published or archived courses yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.courseId} className="border-b border-border last:border-0">
                  <td className={cn(BODY_CELL, "font-medium")}>
                    {row.title}
                  </td>
                  {showInstructor && <td className={BODY_CELL}>{row.instructorName}</td>}
                  <td className={NUMBER_CELL}>
                    {formatMoney(row.earningsCents)}
                    <span className="block text-xs text-muted-foreground">
                      of {formatMoney(row.grossCents)}
                    </span>
                  </td>
                  <td className={NUMBER_CELL}>{row.enrollments}</td>
                  <td className={NUMBER_CELL}>
                    {formatPercent(row.strictCompletionRate)}
                  </td>
                  <td className={NUMBER_CELL}>{formatPercent(row.averageProgress)}</td>
                  <td className={NUMBER_CELL}>
                    {row.rating.average === null ? (
                      <span className="text-muted-foreground">No ratings</span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
                        {row.rating.average.toFixed(1)}
                        <span className="text-xs text-muted-foreground">({row.rating.count})</span>
                      </span>
                    )}
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

function RevenueByCountry({ rows }: { rows: CountryRevenue[] }) {
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

function TopBuyersTable({ rows }: { rows: TopBuyer[] }) {
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

const ALL_INSTRUCTORS = "all";

function InstructorPicker({
  instructors,
  selectedInstructorId,
}: {
  instructors: { id: number; name: string }[];
  selectedInstructorId: number | null;
}) {
  const [, setSearchParams] = useSearchParams();
  return (
    <Select
      value={selectedInstructorId === null ? ALL_INSTRUCTORS : String(selectedInstructorId)}
      onValueChange={(value) =>
        setSearchParams(
          (params) => {
            if (value === ALL_INSTRUCTORS) params.delete("instructorId");
            else params.set("instructorId", value);
            return params;
          },
          { preventScrollReset: true }
        )
      }
    >
      <SelectTrigger className="h-8 w-48 text-sm" aria-label="Instructor">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_INSTRUCTORS}>All instructors</SelectItem>
        {instructors.map((i) => (
          <SelectItem key={i.id} value={String(i.id)}>
            {i.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AnalyticsSection({
  analytics,
  isAdmin,
  instructors,
  selectedInstructorId,
}: {
  analytics: InstructorAnalytics;
  isAdmin: boolean;
  instructors: { id: number; name: string }[];
  selectedInstructorId: number | null;
}) {
  const { range, cards, comparison, courses, revenueByCountry, topBuyers } = analytics;
  const [searchParams] = useSearchParams();

  function rangeHref(r: AnalyticsRange) {
    const params = new URLSearchParams(searchParams);
    params.set("range", r);
    return `?${params}`;
  }

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Analytics</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <InstructorPicker
              instructors={instructors}
              selectedInstructorId={selectedInstructorId}
            />
          )}
          <Link
            to="/instructor/questions"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <MessageCircleQuestion className="size-4" />
            Student questions
          </Link>
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
        </div>
      </div>

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

      <h3 className="mb-3 mt-8 text-lg font-semibold">Courses</h3>
      <CourseTable rows={courses} showInstructor={isAdmin && selectedInstructorId === null} />

      <h3 className="mb-1 mt-8 text-lg font-semibold">Revenue by country</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Gross sales by buyer country, reflecting purchasing-power pricing
      </p>
      <RevenueByCountry rows={revenueByCountry} />

      <h3 className="mb-1 mt-8 text-lg font-semibold">Top buyers</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Ranked by total spent in this range. Unclaimed seats are team members who haven't
        joined yet.
      </p>
      <TopBuyersTable rows={topBuyers} />
    </section>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case CourseStatus.Published:
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
          Published
        </span>
      );
    case CourseStatus.Draft:
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          Draft
        </span>
      );
    case CourseStatus.Archived:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
          Archived
        </span>
      );
    default:
      return null;
  }
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-2 h-5 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="flex flex-col">
            <Skeleton className="aspect-video rounded-b-none rounded-t-lg" />
            <CardHeader>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
            </CardHeader>
            <CardContent className="flex-1">
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </CardContent>
            <CardFooter>
              <Skeleton className="h-10 w-full" />
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function InstructorDashboard({
  loaderData,
}: Route.ComponentProps) {
  const { isAdmin, instructors, selectedInstructorId, courses, analytics } = loaderData;
  const title = isAdmin ? "Instructor Analytics" : "My Courses";

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{title}</span>
      </nav>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-1 text-muted-foreground">
            {isAdmin
              ? "Sales and engagement across instructors"
              : "Manage your courses and track enrollments"}
          </p>
        </div>
        {!isAdmin && (
          <Link to="/instructor/new">
            <Button>
              <Plus className="mr-2 size-4" />
              New Course
            </Button>
          </Link>
        )}
      </div>

      <AnalyticsSection
        analytics={analytics}
        isAdmin={isAdmin}
        instructors={instructors}
        selectedInstructorId={selectedInstructorId}
      />

      {isAdmin ? null : courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first course to get started.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Card key={course.id} className="flex flex-col overflow-hidden pt-0">
              <Link to={`/courses/${course.slug}`} className="aspect-video overflow-hidden">
                <CourseImage
                  src={course.coverImageUrl}
                  alt={course.title}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
              </Link>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to={`/courses/${course.slug}`}
                    className="text-lg font-semibold leading-tight hover:text-primary"
                  >
                    {course.title}
                  </Link>
                  {statusBadge(course.status)}
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {course.description}
                </p>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="size-4" />
                    <span>
                      {course.lessonCount}{" "}
                      {course.lessonCount === 1 ? "lesson" : "lessons"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="size-4" />
                    <span>
                      {course.enrollmentCount}{" "}
                      {course.enrollmentCount === 1 ? "student" : "students"}
                    </span>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Link to={`/instructor/${course.id}`} className="w-full">
                  <Button className="w-full" variant="outline">
                    <BookOpen className="mr-2 size-4" />
                    Edit Course
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your courses.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message = typeof error.data === "string" ? error.data : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
