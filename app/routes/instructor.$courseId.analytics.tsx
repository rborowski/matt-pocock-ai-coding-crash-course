import { Link, data, isRouteErrorResponse, useSearchParams } from "react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Route } from "./+types/instructor.$courseId.analytics";
import { requireStaff } from "~/lib/access.server";
import { getCourseById } from "~/services/courseService";
import { getCourseAnalytics, parseAnalyticsRange } from "~/services/analyticsService";
import {
  HeadlineCardGrid,
  LessonFunnelChart,
  RangeNav,
  RevenueByCountry,
  TopBuyersTable,
} from "~/components/analytics";
import { Button } from "~/components/ui/button";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `Sales and engagement for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const courseId = Number(params.courseId);
  if (!Number.isInteger(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  // 401 without a session; 403 unless the course's own instructor or an admin.
  await requireStaff(request, courseId);

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const range = parseAnalyticsRange(new URL(request.url).searchParams.get("range"));

  return {
    course: { id: course.id, title: course.title },
    analytics: getCourseAnalytics(course.id, range, new Date()),
  };
}

export default function CourseAnalyticsPage({ loaderData }: Route.ComponentProps) {
  const { course, analytics } = loaderData;
  const { range, cards, comparison, revenueByCountry, topBuyers, lessonFunnel } = analytics;
  // Back to the roll-up with the same range (and an admin's instructorId).
  const [searchParams] = useSearchParams();
  const rollupParams = new URLSearchParams(searchParams);
  rollupParams.set("range", range);
  const rollupHref = `/instructor?${rollupParams}`;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to={rollupHref} className="hover:text-foreground">
          Instructor
        </Link>
        <span className="mx-2">/</span>
        <Link to={`/instructor/${course.id}`} className="hover:text-foreground">
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{course.title}</h1>
          <p className="mt-1 text-muted-foreground">Sales and engagement for this course</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={rollupHref}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All courses
          </Link>
          <RangeNav range={range} />
        </div>
      </div>

      <HeadlineCardGrid cards={cards} comparison={comparison} />

      <h2 className="mb-1 mt-8 text-lg font-semibold">Revenue by country</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Gross sales by buyer country, reflecting purchasing-power pricing
      </p>
      <RevenueByCountry rows={revenueByCountry} />

      <h2 className="mb-1 mt-8 text-lg font-semibold">Top 5 buyers</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Ranked by total spent on this course in this range. Unclaimed seats are team
        members who haven't joined yet.
      </p>
      <TopBuyersTable rows={topBuyers} />

      <h2 className="mb-1 mt-8 text-lg font-semibold">Lesson drop-off</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Share of the {lessonFunnel.cohortSize} students who enrolled in this range that
        completed each lesson, in course order. The lesson with the biggest drop from the one
        before it is highlighted; the first lesson is compared against 100%. Recent
        enrollments lower the completion of later lessons, because those students haven't
        reached them yet.
      </p>
      <LessonFunnelChart funnel={lessonFunnel} />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

  if (isRouteErrorResponse(error)) {
    const detail = typeof error.data === "string" ? error.data : undefined;
    if (error.status === 401) {
      title = "Sign in required";
      message = detail ?? "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = detail ?? "You don't have permission to view this course's analytics.";
    } else if (error.status === 404) {
      title = "Course not found";
      message = detail ?? "The course you're looking for doesn't exist.";
    } else {
      title = `Error ${error.status}`;
      message = detail ?? error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/instructor">
            <Button variant="outline">My Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
