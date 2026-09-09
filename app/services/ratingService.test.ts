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
import {
  getRatingByUser,
  getAverageRating,
  getRatingDistribution,
  canUserRateCourse,
  rateCourse,
} from "./ratingService";

function enroll(userId: number, courseId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId })
    .returning()
    .get();
}

function createDraftCourse() {
  return testDb
    .insert(schema.courses)
    .values({
      title: "Draft Course",
      slug: "draft-course",
      description: "A draft course",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Draft,
    })
    .returning()
    .get();
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("rateCourse", () => {
    it("throws when the user is not enrolled", () => {
      expect(() => rateCourse(base.user.id, base.course.id, 5)).toThrowError(
        "User must be enrolled in this course to rate it"
      );
    });

    it("throws when the course does not exist", () => {
      expect(() => rateCourse(base.user.id, 999999, 5)).toThrowError(
        "Course not found"
      );
    });

    it("throws when the course is not published (draft/archived)", () => {
      const draftCourse = createDraftCourse();
      enroll(base.user.id, draftCourse.id);

      expect(() =>
        rateCourse(base.user.id, draftCourse.id, 5)
      ).toThrowError("Only published courses can be rated");
    });

    it("throws for a non-integer rating", () => {
      enroll(base.user.id, base.course.id);

      expect(() => rateCourse(base.user.id, base.course.id, 3.5)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("throws for a rating below 1", () => {
      enroll(base.user.id, base.course.id);

      expect(() => rateCourse(base.user.id, base.course.id, 0)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("throws for a rating above 5", () => {
      enroll(base.user.id, base.course.id);

      expect(() => rateCourse(base.user.id, base.course.id, 6)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("throws when the course's own instructor tries to rate it", () => {
      // Enroll the instructor too (edge case) — should still be rejected.
      enroll(base.instructor.id, base.course.id);

      expect(() =>
        rateCourse(base.instructor.id, base.course.id, 5)
      ).toThrowError("Instructors cannot rate their own course");
    });

    it("allows an enrolled non-instructor to rate the course", () => {
      enroll(base.user.id, base.course.id);

      const rating = rateCourse(base.user.id, base.course.id, 4);

      expect(rating).toBeDefined();
      expect(rating.userId).toBe(base.user.id);
      expect(rating.courseId).toBe(base.course.id);
      expect(rating.rating).toBe(4);
    });

    it("upserts: re-rating updates the existing row instead of creating a new one", () => {
      enroll(base.user.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 2);
      rateCourse(base.user.id, base.course.id, 5);

      const all = testDb.select().from(schema.ratings).all();
      expect(all).toHaveLength(1);
      expect(all[0].rating).toBe(5);
    });
  });

  describe("getRatingByUser", () => {
    it("returns undefined when the user has not rated the course", () => {
      expect(getRatingByUser(base.user.id, base.course.id)).toBeUndefined();
    });

    it("returns the user's own rating row", () => {
      enroll(base.user.id, base.course.id);
      rateCourse(base.user.id, base.course.id, 3);

      const rating = getRatingByUser(base.user.id, base.course.id);
      expect(rating).toBeDefined();
      expect(rating!.rating).toBe(3);
    });
  });

  describe("getAverageRating", () => {
    it("returns average 0 and count 0 when there are no ratings", () => {
      expect(getAverageRating(base.course.id)).toEqual({
        average: 0,
        count: 0,
      });
    });

    it("computes the average and count across multiple raters", () => {
      const student2 = testDb
        .insert(schema.users)
        .values({
          name: "Student Two",
          email: "student2@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      enroll(base.user.id, base.course.id);
      enroll(student2.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 4);
      rateCourse(student2.id, base.course.id, 5);

      expect(getAverageRating(base.course.id)).toEqual({
        average: 4.5,
        count: 2,
      });
    });
  });

  describe("getRatingDistribution", () => {
    it("includes all five buckets at zero when there are no ratings", () => {
      expect(getRatingDistribution(base.course.id)).toEqual({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      });
    });

    it("counts ratings per star, including empty buckets", () => {
      const student2 = testDb
        .insert(schema.users)
        .values({
          name: "Student Two",
          email: "student2@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      enroll(base.user.id, base.course.id);
      enroll(student2.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 5);
      rateCourse(student2.id, base.course.id, 5);

      expect(getRatingDistribution(base.course.id)).toEqual({
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 2,
      });
    });
  });

  describe("canUserRateCourse", () => {
    it("returns true for an enrolled non-instructor", () => {
      enroll(base.user.id, base.course.id);
      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(true);
    });

    it("returns false for a non-enrolled user", () => {
      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(false);
    });

    it("returns false for the course's own instructor", () => {
      enroll(base.instructor.id, base.course.id);
      expect(canUserRateCourse(base.instructor.id, base.course.id)).toBe(
        false
      );
    });

    it("returns false for a draft course, even if enrolled", () => {
      const draftCourse = createDraftCourse();
      enroll(base.user.id, draftCourse.id);

      expect(canUserRateCourse(base.user.id, draftCourse.id)).toBe(false);
    });
  });
});
