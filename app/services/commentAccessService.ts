import { UserRole } from "~/db/schema";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";
import { canParticipateInComments } from "~/lib/comments";
import { isUserEnrolled } from "./enrollmentService";
import { findPurchase } from "./purchaseService";
import { getUserById } from "./userService";

// ─── Comment Access Service ───
// Single source of truth for who may read/write lesson comments on a course.
// Recomputed from scratch (never from client input) for every request.
// Uses positional parameters (project convention).

type PppCourse = { price: number; pppEnabled: boolean };

/** Shared by loader and action so both make the same PPP decision. */
export async function evaluatePpp(
  request: Request,
  userId: number,
  courseId: number,
  course: PppCourse
) {
  const purchase = findPurchase(userId, courseId);
  const currentCountry = await resolveCountry(request);
  return checkPppAccess(
    course.price,
    course.pppEnabled,
    purchase?.country ?? null,
    currentCountry
  );
}

export type CommentAccess = {
  canComment: boolean;
  isModerator: boolean;
};

/**
 * Pure-ish access decision from already-known enrollment and PPP state. The
 * loader uses this directly since it computes both for other UI anyway.
 */
export function resolveCommentAccess(
  userId: number | null,
  course: { instructorId: number },
  enrolled: boolean,
  pppBlocked: boolean
): CommentAccess {
  if (userId === null) return { canComment: false, isModerator: false };
  const user = getUserById(userId);
  if (!user) return { canComment: false, isModerator: false };
  const isCourseOwner = course.instructorId === userId;
  return {
    canComment: canParticipateInComments({
      role: user.role,
      isCourseOwner,
      isEnrolled: enrolled,
      isPppBlocked: pppBlocked,
    }),
    isModerator: isCourseOwner || user.role === UserRole.Admin,
  };
}

/** Full access check from scratch; used by the action on every mutation. */
export async function getCommentAccess(
  request: Request,
  userId: number | null,
  course: { id: number; instructorId: number } & PppCourse
): Promise<CommentAccess & { enrolled: boolean; pppBlocked: boolean }> {
  if (userId === null) {
    return {
      canComment: false,
      isModerator: false,
      enrolled: false,
      pppBlocked: false,
    };
  }
  const enrolled = isUserEnrolled(userId, course.id);
  const pppBlocked = enrolled
    ? (await evaluatePpp(request, userId, course.id, course)).blocked
    : false;
  return {
    ...resolveCommentAccess(userId, course, enrolled, pppBlocked),
    enrolled,
    pppBlocked,
  };
}
