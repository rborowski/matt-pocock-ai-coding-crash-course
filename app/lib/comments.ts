// Pure helpers for lesson comments. Kept free of database imports so client
// components can use them too.

import { UserRole } from "~/db/schema";

export const COMMENT_MAX_LENGTH = 2000;

export type CommentParticipant = {
  role: UserRole;
  isCourseOwner: boolean;
  isEnrolled: boolean;
  isPppBlocked: boolean;
};

/**
 * Who may read and write lesson comments: admins, the course owner, and
 * enrolled users who are not PPP-blocked. A non-owner instructor is treated
 * exactly like a student.
 */
export function canParticipateInComments({
  role,
  isCourseOwner,
  isEnrolled,
  isPppBlocked,
}: CommentParticipant): boolean {
  if (role === UserRole.Admin) return true;
  if (isCourseOwner) return true;
  return isEnrolled && !isPppBlocked;
}
