import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { getInstructorAnalytics } from "./analyticsService";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const DAY = 86_400_000;

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

let userCounter = 0;
function createStudent() {
  userCounter++;
  return testDb
    .insert(schema.users)
    .values({
      name: `Student ${userCounter}`,
      email: `student${userCounter}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function createCourse(status: schema.CourseStatus, instructorId = base.instructor.id) {
  userCounter++;
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${userCounter}`,
      slug: `course-${userCounter}`,
      description: "A course",
      salesCopy: "Sales copy.",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

function purchase(userId: number, courseId: number, amountPaid: number, createdAt: string) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country: "US", createdAt })
    .returning()
    .get();
}

function enroll(
  userId: number,
  courseId: number,
  enrolledAt: string,
  completedAt: string | null = null
) {
  return testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, enrolledAt, completedAt })
    .returning()
    .get();
}

describe("analyticsService.getInstructorAnalytics", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("applies the platform fee once to the summed gross, not per purchase", () => {
    // Per row: round(999 * 0.8) = 799, × 3 = 2397.
    // Once on the total: round(2997 * 0.8) = round(2397.6) = 2398.
    for (let i = 0; i < 3; i++) {
      purchase(createStudent().id, base.course.id, 999, daysAgo(1));
    }

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.grossCents).toBe(2997);
    expect(cards.earningsCents).toBe(2398);
  });

  it("includes purchases and enrollments exactly at the window start and excludes earlier ones", () => {
    const atBoundary = createStudent();
    const justBefore = createStudent();
    const boundary = daysAgo(30);
    const oneMsEarlier = new Date(NOW.getTime() - 30 * DAY - 1).toISOString();

    purchase(atBoundary.id, base.course.id, 1000, boundary);
    enroll(atBoundary.id, base.course.id, boundary);
    purchase(justBefore.id, base.course.id, 5000, oneMsEarlier);
    enroll(justBefore.id, base.course.id, oneMsEarlier);

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.grossCents).toBe(1000);
    expect(cards.buyers).toBe(1);
    expect(cards.students).toBe(1);
  });

  describe("previous-period comparison", () => {
    it("compares revenue and enrollments with the previous period of the same length", () => {
      const a = createStudent();
      const b = createStudent();
      const c = createStudent();
      // Current 30d window: $30 and two enrollments.
      purchase(a.id, base.course.id, 3000, daysAgo(5));
      enroll(a.id, base.course.id, daysAgo(5));
      enroll(b.id, base.course.id, daysAgo(10));
      // Previous window (60–30 days ago): $20 and one enrollment.
      purchase(c.id, base.course.id, 2000, daysAgo(45));
      enroll(c.id, base.course.id, daysAgo(45));
      // Older than both windows: ignored.
      purchase(createStudent().id, base.course.id, 9900, daysAgo(61));

      const { comparison } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(comparison).toEqual({
        previousGrossCents: 2000,
        previousEarningsCents: 1600,
        revenueChangePct: 50,
        previousStudents: 1,
        studentsChangePct: 100,
      });
    });

    it("counts a purchase exactly 30 days ago in the current period only", () => {
      purchase(createStudent().id, base.course.id, 1000, daysAgo(30));

      const { cards, comparison } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(cards.grossCents).toBe(1000);
      expect(comparison?.previousGrossCents).toBe(0);
    });

    it("reports no percentage change when the previous period had zero revenue", () => {
      purchase(createStudent().id, base.course.id, 1500, daysAgo(3));

      const { comparison } = getInstructorAnalytics(base.instructor.id, "90d", NOW);

      expect(comparison?.previousGrossCents).toBe(0);
      expect(comparison?.revenueChangePct).toBeNull();
    });

    it("is not computed for the all-time range", () => {
      purchase(createStudent().id, base.course.id, 1500, daysAgo(3));

      const { comparison } = getInstructorAnalytics(base.instructor.id, "all", NOW);

      expect(comparison).toBeNull();
    });
  });

  it("counts team coupons as seats and only redeemed seats as claimed students", () => {
    const teamBuyer = createStudent();
    const team = testDb.insert(schema.teams).values({}).returning().get();
    const teamPurchase = purchase(teamBuyer.id, base.course.id, 25000, daysAgo(2));
    for (let i = 0; i < 5; i++) {
      const redeemer = i < 2 ? createStudent() : null;
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: `CODE-${i}`,
          purchaseId: teamPurchase.id,
          redeemedByUserId: redeemer?.id ?? null,
          redeemedAt: redeemer ? daysAgo(1) : null,
        })
        .run();
      if (redeemer) enroll(redeemer.id, base.course.id, daysAgo(1));
    }

    const individual = createStudent();
    purchase(individual.id, base.course.id, 5000, daysAgo(2));
    enroll(individual.id, base.course.id, daysAgo(2));

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.grossCents).toBe(30000);
    expect(cards.buyers).toBe(2);
    expect(cards.students).toBe(3);
    expect(cards.seatsSold).toBe(6);
    expect(cards.seatsClaimed).toBe(3);
  });

  it("counts a free-course enrollment with no purchase as a student but not a buyer", () => {
    enroll(createStudent().id, base.course.id, daysAgo(4));

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.students).toBe(1);
    expect(cards.buyers).toBe(0);
    expect(cards.grossCents).toBe(0);
    expect(cards.seatsSold).toBe(0);
  });

  it("does not count the $0 purchase recorded for a free-course enrollment as a buyer or seat", () => {
    // The purchase flow records a $0 purchase when a student takes a free course.
    const student = createStudent();
    purchase(student.id, base.course.id, 0, daysAgo(4));
    enroll(student.id, base.course.id, daysAgo(4));

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.students).toBe(1);
    expect(cards.buyers).toBe(0);
    expect(cards.grossCents).toBe(0);
    expect(cards.seatsSold).toBe(0);
  });

  it("excludes draft courses and includes archived courses", () => {
    const draft = createCourse(schema.CourseStatus.Draft);
    const archived = createCourse(schema.CourseStatus.Archived);
    const draftBuyer = createStudent();
    const archivedBuyer = createStudent();
    purchase(draftBuyer.id, draft.id, 7000, daysAgo(3));
    enroll(draftBuyer.id, draft.id, daysAgo(3));
    purchase(archivedBuyer.id, archived.id, 4000, daysAgo(3));
    enroll(archivedBuyer.id, archived.id, daysAgo(3));

    const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

    expect(cards.grossCents).toBe(4000);
    expect(cards.buyers).toBe(1);
    expect(cards.students).toBe(1);
  });

  it("covers only the given instructor's courses, or every instructor's when null", () => {
    const other = testDb
      .insert(schema.users)
      .values({ name: "Other", email: "other@example.com", role: schema.UserRole.Instructor })
      .returning()
      .get();
    const otherCourse = createCourse(schema.CourseStatus.Published, other.id);
    purchase(createStudent().id, base.course.id, 1000, daysAgo(1));
    purchase(createStudent().id, otherCourse.id, 2000, daysAgo(1));

    expect(getInstructorAnalytics(base.instructor.id, "30d", NOW).cards.grossCents).toBe(1000);
    expect(getInstructorAnalytics(null, "30d", NOW).cards.grossCents).toBe(3000);
  });

  describe("completion", () => {
    function addLessons(courseId: number, count: number) {
      const mod = testDb
        .insert(schema.modules)
        .values({ courseId, title: "Module", position: 1 })
        .returning()
        .get();
      return Array.from({ length: count }, (_, i) =>
        testDb
          .insert(schema.lessons)
          .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
          .returning()
          .get()
      );
    }

    function progress(
      userId: number,
      lessonId: number,
      status = schema.LessonProgressStatus.Completed
    ) {
      testDb
        .insert(schema.lessonProgress)
        .values({ userId, lessonId, status, completedAt: daysAgo(1) })
        .run();
    }

    it("measures the cohort who enrolled within the range on their progress today", () => {
      const lessons = addLessons(base.course.id, 4);
      const secondCourse = createCourse(schema.CourseStatus.Published);
      const secondLessons = addLessons(secondCourse.id, 2);

      // Finished the 4-lesson course: progress 1.
      const finisher = createStudent();
      enroll(finisher.id, base.course.id, daysAgo(20), daysAgo(1));
      lessons.forEach((l) => progress(finisher.id, l.id));

      // 1 of 4 completed, 1 merely in progress: progress 0.25.
      const starter = createStudent();
      enroll(starter.id, base.course.id, daysAgo(10));
      progress(starter.id, lessons[0].id);
      progress(starter.id, lessons[1].id, schema.LessonProgressStatus.InProgress);

      // 1 of 2 on the second course: progress 0.5. Their progress on the
      // first course (not enrolled) must not leak in.
      const halfway = createStudent();
      enroll(halfway.id, secondCourse.id, daysAgo(5));
      progress(halfway.id, secondLessons[0].id);
      progress(halfway.id, lessons[2].id);

      // Enrolled before the range: outside the cohort.
      const veteran = createStudent();
      enroll(veteran.id, base.course.id, daysAgo(200), daysAgo(150));
      lessons.forEach((l) => progress(veteran.id, l.id));

      const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(cards.strictCompletionRate).toBeCloseTo(1 / 3);
      expect(cards.averageProgress).toBeCloseTo((1 + 0.25 + 0.5) / 3);
    });

    it("reports no completion figures when nobody enrolled in the range", () => {
      addLessons(base.course.id, 3);

      const { cards } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(cards.strictCompletionRate).toBeNull();
      expect(cards.averageProgress).toBeNull();
    });
  });

  it("covers everything for the all-time range", () => {
    const student = createStudent();
    purchase(student.id, base.course.id, 1000, daysAgo(400));
    enroll(student.id, base.course.id, daysAgo(400));

    const { cards } = getInstructorAnalytics(base.instructor.id, "all", NOW);

    expect(cards.grossCents).toBe(1000);
    expect(cards.students).toBe(1);
  });
});
