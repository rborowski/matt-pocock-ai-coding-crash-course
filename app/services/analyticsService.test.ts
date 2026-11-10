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

function createInstructor() {
  userCounter++;
  return testDb
    .insert(schema.users)
    .values({
      name: `Instructor ${userCounter}`,
      email: `instructor${userCounter}@example.com`,
      role: schema.UserRole.Instructor,
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

function purchase(
  userId: number,
  courseId: number,
  amountPaid: number,
  createdAt: string,
  country: string | null = "US"
) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country, createdAt })
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

function addLessons(courseId: number, count: number) {
  const module = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: `Lesson ${i + 1}`, position: i + 1 })
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

function rate(userId: number, courseId: number, rating: number) {
  testDb.insert(schema.courseRatings).values({ userId, courseId, rating }).run();
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
    const other = createInstructor();
    const otherCourse = createCourse(schema.CourseStatus.Published, other.id);
    purchase(createStudent().id, base.course.id, 1000, daysAgo(1));
    purchase(createStudent().id, otherCourse.id, 2000, daysAgo(1));

    expect(getInstructorAnalytics(base.instructor.id, "30d", NOW).cards.grossCents).toBe(1000);
    expect(getInstructorAnalytics(null, "30d", NOW).cards.grossCents).toBe(3000);
  });

  describe("completion", () => {
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

  describe("course rows", () => {
    it("reports earnings, enrollments, completion and rating per course within the range", () => {
      const lessons = addLessons(base.course.id, 2);
      const second = createCourse(schema.CourseStatus.Published);

      const finisher = createStudent();
      purchase(finisher.id, base.course.id, 999, daysAgo(3));
      enroll(finisher.id, base.course.id, daysAgo(3), daysAgo(1));
      lessons.forEach((l) => progress(finisher.id, l.id));

      const starter = createStudent();
      purchase(starter.id, base.course.id, 999, daysAgo(5));
      enroll(starter.id, base.course.id, daysAgo(5));

      // Outside the 30d range: no revenue or enrollment for the row.
      const veteran = createStudent();
      purchase(veteran.id, base.course.id, 5000, daysAgo(100));
      enroll(veteran.id, base.course.id, daysAgo(100));

      const secondBuyer = createStudent();
      purchase(secondBuyer.id, second.id, 2000, daysAgo(1));
      enroll(secondBuyer.id, second.id, daysAgo(1));

      rate(finisher.id, base.course.id, 5);
      rate(starter.id, base.course.id, 4);
      rate(veteran.id, base.course.id, 4);

      const { courses } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(courses).toEqual([
        {
          courseId: base.course.id,
          title: base.course.title,
          instructorName: base.instructor.name,
          grossCents: 1998,
          // Fee applied once to the course's gross: round(1998 * 0.8).
          earningsCents: 1598,
          enrollments: 2,
          strictCompletionRate: 0.5,
          averageProgress: 0.5,
          rating: { average: 4.3, count: 3 },
        },
        {
          courseId: second.id,
          title: second.title,
          instructorName: base.instructor.name,
          grossCents: 2000,
          earningsCents: 1600,
          enrollments: 1,
          strictCompletionRate: 0,
          averageProgress: 0,
          rating: { average: null, count: 0 },
        },
      ]);
    });

    it("shows a course with no enrollments in the range without dividing by zero", () => {
      addLessons(base.course.id, 3);

      const { courses } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(courses).toEqual([
        {
          courseId: base.course.id,
          title: base.course.title,
          instructorName: base.instructor.name,
          grossCents: 0,
          earningsCents: 0,
          enrollments: 0,
          strictCompletionRate: null,
          averageProgress: null,
          rating: { average: null, count: 0 },
        },
      ]);
    });

    it("lists archived courses and leaves out drafts", () => {
      const draft = createCourse(schema.CourseStatus.Draft);
      const archived = createCourse(schema.CourseStatus.Archived);
      purchase(createStudent().id, draft.id, 7000, daysAgo(3));
      purchase(createStudent().id, archived.id, 4000, daysAgo(3));

      const { courses } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(courses.map((c) => [c.courseId, c.grossCents])).toEqual([
        [base.course.id, 0],
        [archived.id, 4000],
      ]);
    });

    it("lists only the given instructor's courses, or every instructor's when null", () => {
      const other = createInstructor();
      const otherCourse = createCourse(schema.CourseStatus.Published, other.id);

      expect(
        getInstructorAnalytics(base.instructor.id, "30d", NOW).courses.map((c) => c.courseId)
      ).toEqual([base.course.id]);
      expect(getInstructorAnalytics(null, "30d", NOW).courses.map((c) => c.courseId)).toEqual([
        base.course.id,
        otherCourse.id,
      ]);
    });

    it("names each course's instructor", () => {
      const other = createInstructor();
      const otherCourse = createCourse(schema.CourseStatus.Published, other.id);

      expect(
        getInstructorAnalytics(null, "30d", NOW).courses.map((c) => [c.courseId, c.instructorName])
      ).toEqual([
        [base.course.id, base.instructor.name],
        [otherCourse.id, other.name],
      ]);
    });
  });

  describe("revenue by country", () => {
    it("groups gross revenue by the purchase's country within the range, largest first", () => {
      purchase(createStudent().id, base.course.id, 1000, daysAgo(1), "US");
      purchase(createStudent().id, base.course.id, 1500, daysAgo(2), "US");
      purchase(createStudent().id, base.course.id, 4000, daysAgo(3), "DE");
      purchase(createStudent().id, base.course.id, 300, daysAgo(4), "IN");
      purchase(createStudent().id, base.course.id, 200, daysAgo(5), null);
      // Outside the range.
      purchase(createStudent().id, base.course.id, 9000, daysAgo(31), "IN");
      // Free enrollment: no revenue.
      purchase(createStudent().id, base.course.id, 0, daysAgo(1), "BR");

      const { revenueByCountry } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(revenueByCountry).toEqual([
        { country: "DE", grossCents: 4000 },
        { country: "US", grossCents: 2500 },
        { country: "IN", grossCents: 300 },
        { country: null, grossCents: 200 },
      ]);
    });

    it("leaves out other instructors' and draft courses", () => {
      const other = createInstructor();
      const otherCourse = createCourse(schema.CourseStatus.Published, other.id);
      const draft = createCourse(schema.CourseStatus.Draft);
      purchase(createStudent().id, base.course.id, 1000, daysAgo(1), "PL");
      purchase(createStudent().id, otherCourse.id, 2000, daysAgo(1), "PL");
      purchase(createStudent().id, draft.id, 3000, daysAgo(1), "FR");

      expect(getInstructorAnalytics(base.instructor.id, "30d", NOW).revenueByCountry).toEqual([
        { country: "PL", grossCents: 1000 },
      ]);
      expect(getInstructorAnalytics(null, "30d", NOW).revenueByCountry).toEqual([
        { country: "PL", grossCents: 3000 },
      ]);
    });
  });

  describe("top buyers", () => {
    function teamPurchase(
      buyerId: number,
      courseId: number,
      amountPaid: number,
      createdAt: string,
      seats: number,
      claimed: number
    ) {
      const team = testDb.insert(schema.teams).values({}).returning().get();
      const row = purchase(buyerId, courseId, amountPaid, createdAt);
      for (let i = 0; i < seats; i++) {
        userCounter++;
        testDb
          .insert(schema.coupons)
          .values({
            teamId: team.id,
            courseId,
            code: `CODE-${userCounter}`,
            purchaseId: row.id,
            redeemedByUserId: i < claimed ? createStudent().id : null,
            redeemedAt: i < claimed ? daysAgo(1) : null,
          })
          .run();
      }
      return row;
    }

    it("ranks buyers by gross spent within the range, breaking ties by seats bought", () => {
      const big = createStudent();
      const team = createStudent();
      const solo = createStudent();
      purchase(big.id, base.course.id, 9000, daysAgo(2));
      teamPurchase(team.id, base.course.id, 5000, daysAgo(3), 4, 1);
      purchase(solo.id, base.course.id, 5000, daysAgo(4));
      // Outside the range: would put solo on top.
      purchase(solo.id, base.course.id, 20000, daysAgo(40));

      const { topBuyers } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(topBuyers.map((b) => [b.userId, b.grossCents, b.seatsBought])).toEqual([
        [big.id, 9000, 1],
        [team.id, 5000, 4],
        [solo.id, 5000, 1],
      ]);
    });

    it("sums a buyer's purchases across courses with claimed and unclaimed seats", () => {
      const second = createCourse(schema.CourseStatus.Archived);
      const buyer = createStudent();
      teamPurchase(buyer.id, base.course.id, 20000, daysAgo(10), 5, 2);
      teamPurchase(buyer.id, second.id, 12000, daysAgo(3), 3, 3);
      purchase(buyer.id, second.id, 4000, daysAgo(6));

      const { topBuyers } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(topBuyers).toEqual([
        {
          userId: buyer.id,
          name: buyer.name,
          email: buyer.email,
          grossCents: 36000,
          seatsBought: 9,
          seatsClaimed: 6,
          seatsUnclaimed: 3,
          // By title: "Course N" sorts before "Test Course".
          courses: [
            { courseId: second.id, title: second.title },
            { courseId: base.course.id, title: base.course.title },
          ],
          lastPurchasedAt: daysAgo(3),
        },
      ]);
    });

    it("shows at most 10 buyers", () => {
      for (let i = 1; i <= 12; i++) {
        purchase(createStudent().id, base.course.id, i * 100, daysAgo(1));
      }

      const { topBuyers } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(topBuyers.map((b) => b.grossCents)).toEqual([
        1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300,
      ]);
    });

    function buyersAcrossInstructors() {
      const other = createInstructor();
      const otherCourse = createCourse(schema.CourseStatus.Published, other.id);
      const draft = createCourse(schema.CourseStatus.Draft);
      const mine = createStudent();
      const theirs = createStudent();
      const both = createStudent();
      purchase(mine.id, base.course.id, 1000, daysAgo(1));
      purchase(theirs.id, otherCourse.id, 3000, daysAgo(1));
      purchase(both.id, base.course.id, 500, daysAgo(1));
      purchase(both.id, otherCourse.id, 2000, daysAgo(1));
      purchase(mine.id, draft.id, 9000, daysAgo(1));
      return { mine, theirs, both };
    }

    it("shows an instructor only buyers of their own courses", () => {
      const { mine, both } = buyersAcrossInstructors();

      const { topBuyers } = getInstructorAnalytics(base.instructor.id, "30d", NOW);

      expect(topBuyers.map((b) => [b.userId, b.grossCents])).toEqual([
        [mine.id, 1000],
        [both.id, 500],
      ]);
    });

    it("ranks buyers across every instructor's courses when no instructor is given", () => {
      const { mine, theirs, both } = buyersAcrossInstructors();

      const { topBuyers } = getInstructorAnalytics(null, "30d", NOW);

      expect(topBuyers.map((b) => [b.userId, b.grossCents])).toEqual([
        [theirs.id, 3000],
        [both.id, 2500],
        [mine.id, 1000],
      ]);
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
