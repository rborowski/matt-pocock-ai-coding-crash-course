import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import { ratings, courses, CourseStatus } from "~/db/schema";
import { isUserEnrolled } from "./enrollmentService";

// ─── Rating Service ───
// Handles course star ratings: upserting a user's rating, and computing
// average/distribution on read (nothing is denormalized onto courses).
// Uses positional parameters (project convention).

export function getRatingByUser(userId: number, courseId: number) {
  return db
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.courseId, courseId)))
    .get();
}

export function getAverageRating(courseId: number) {
  const result = db
    .select({
      average: sql<number>`avg(${ratings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(ratings)
    .where(eq(ratings.courseId, courseId))
    .get();

  if (!result || !result.count) return { average: 0, count: 0 };

  return {
    average: Math.round(result.average * 10) / 10,
    count: result.count,
  };
}

// Returns counts for every star value 1-5, always including buckets that
// have zero ratings (so the UI can render a full histogram).
export function getRatingDistribution(courseId: number) {
  const rows = db
    .select({
      rating: ratings.rating,
      count: sql<number>`count(*)`,
    })
    .from(ratings)
    .where(eq(ratings.courseId, courseId))
    .groupBy(ratings.rating)
    .all();

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  for (const row of rows) {
    distribution[row.rating as 1 | 2 | 3 | 4 | 5] = row.count;
  }

  return distribution;
}

export function canUserRateCourse(userId: number, courseId: number) {
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return false;
  if (course.status !== CourseStatus.Published) return false;
  if (course.instructorId === userId) return false;

  return isUserEnrolled(userId, courseId);
}

export function rateCourse(userId: number, courseId: number, rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be an integer between 1 and 5");
  }

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) {
    throw new Error("Course not found");
  }

  if (course.status !== CourseStatus.Published) {
    throw new Error("Only published courses can be rated");
  }

  if (course.instructorId === userId) {
    throw new Error("Instructors cannot rate their own course");
  }

  if (!isUserEnrolled(userId, courseId)) {
    throw new Error("User must be enrolled in this course to rate it");
  }

  // Upsert in a single statement rather than the read-then-branch pattern used
  // by markLessonComplete: two fast clicks on the star picker can both observe
  // "no existing row" and race into duplicate inserts. That's safe to do here
  // (and not in lesson_progress) because ratings has a real
  // UNIQUE(user_id, course_id) index to conflict on.
  return db
    .insert(ratings)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}
