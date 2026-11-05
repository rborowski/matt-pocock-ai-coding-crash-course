import { eq, and, isNull, asc, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  lessonComments,
  lessons,
  modules,
  courses,
  users,
  UserRole,
} from "~/db/schema";
import { COMMENT_MAX_LENGTH } from "~/lib/comments";

// ─── Comment Service ───
// Lesson discussion: top-level comments plus one level of replies.
// Participation (enrolled + not PPP-blocked) is checked in the route via
// canParticipateInComments, because PPP is computed asynchronously. Mutations
// here still enforce author / owner / admin authorization themselves.
// Uses positional parameters (project convention).

export type CommentBadge = "instructor" | "admin" | null;

export type CommentAuthor = {
  id: number;
  name: string;
  avatarUrl: string | null;
  badge: CommentBadge;
};

export type VisibleComment = {
  id: number;
  lessonId: number;
  parentId: number | null;
  deleted: false;
  body: string;
  createdAt: string;
  editedAt: string | null;
  edited: boolean;
  author: CommentAuthor;
};

export type DeletedComment = {
  id: number;
  lessonId: number;
  parentId: number | null;
  deleted: true;
  createdAt: string;
};

export type CommentItem = VisibleComment | DeletedComment;

export type CommentThread = {
  comment: CommentItem;
  replies: CommentItem[];
};

export type DeleteResult = { mode: "soft" | "hard" };

export type CommentErrorStatus = 400 | 403 | 404;

/** A business-rule violation that is safe to show to the user. */
export class CommentError extends Error {
  status: CommentErrorStatus;
  constructor(message: string, status: CommentErrorStatus = 400) {
    super(message);
    this.name = "CommentError";
    this.status = status;
  }
}

function normalizeBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (trimmed.length === 0) {
    throw new CommentError("Comment cannot be empty");
  }
  if (trimmed.length > COMMENT_MAX_LENGTH) {
    throw new CommentError(
      `Comment must be at most ${COMMENT_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

export function getCommentById(commentId: number) {
  return db
    .select()
    .from(lessonComments)
    .where(eq(lessonComments.id, commentId))
    .get();
}

function getLessonOwnerId(lessonId: number): number | undefined {
  return db
    .select({ instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get()?.instructorId;
}

/**
 * Threads for a lesson, oldest first. Soft-deleted comments come back as
 * placeholders (no body, no author) so threads stay intact.
 */
export function getLessonCommentThreads(lessonId: number): CommentThread[] {
  const ownerId = getLessonOwnerId(lessonId);

  const rows = db
    .select({
      comment: lessonComments,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
      authorRole: users.role,
    })
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(eq(lessonComments.lessonId, lessonId))
    .orderBy(asc(lessonComments.createdAt), asc(lessonComments.id))
    .all();

  const toItem = (row: (typeof rows)[number]): CommentItem => {
    const c = row.comment;
    if (c.deletedAt) {
      return {
        id: c.id,
        lessonId: c.lessonId,
        parentId: c.parentId,
        deleted: true,
        createdAt: c.createdAt,
      };
    }
    const badge: CommentBadge =
      c.userId === ownerId
        ? "instructor"
        : row.authorRole === UserRole.Admin
          ? "admin"
          : null;
    return {
      id: c.id,
      lessonId: c.lessonId,
      parentId: c.parentId,
      deleted: false,
      body: c.body,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      edited: c.editedAt !== null,
      author: {
        id: c.userId,
        name: row.authorName,
        avatarUrl: row.authorAvatarUrl,
        badge,
      },
    };
  };

  const threads = new Map<number, CommentThread>();
  for (const row of rows) {
    if (row.comment.parentId === null) {
      threads.set(row.comment.id, { comment: toItem(row), replies: [] });
    }
  }
  for (const row of rows) {
    if (row.comment.parentId !== null) {
      threads.get(row.comment.parentId)?.replies.push(toItem(row));
    }
  }
  return [...threads.values()];
}

/** Number of non-deleted comments (top-level and replies) in a lesson. */
export function countVisibleLessonComments(lessonId: number): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessonComments)
      .where(
        and(
          eq(lessonComments.lessonId, lessonId),
          isNull(lessonComments.deletedAt)
        )
      )
      .get()?.count ?? 0
  );
}

/**
 * Creates a comment. Does NOT check participation — the route must do that
 * with canParticipateInComments before calling.
 */
export function createComment(
  lessonId: number,
  userId: number,
  body: string,
  parentId: number | null = null
) {
  const text = normalizeBody(body);

  const lesson = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw new CommentError("Lesson not found", 404);
  }

  if (parentId !== null) {
    const parent = getCommentById(parentId);
    if (!parent || parent.lessonId !== lessonId) {
      throw new CommentError("Parent comment not found in this lesson", 404);
    }
    if (parent.parentId !== null) {
      throw new CommentError("Cannot reply to a reply");
    }
    if (parent.deletedAt) {
      throw new CommentError("Cannot reply to a deleted comment");
    }
  }

  return db
    .insert(lessonComments)
    .values({ lessonId, userId, body: text, parentId })
    .returning()
    .get();
}

/** Only the author may edit, and only a non-deleted comment. */
export function editComment(
  commentId: number,
  actorUserId: number,
  body: string
) {
  const comment = getCommentById(commentId);
  if (!comment) {
    throw new CommentError("Comment not found", 404);
  }
  if (comment.deletedAt) {
    throw new CommentError("Cannot edit a deleted comment");
  }
  if (comment.userId !== actorUserId) {
    throw new CommentError("Only the author can edit this comment", 403);
  }
  const text = normalizeBody(body);

  return db
    .update(lessonComments)
    .set({ body: text, editedAt: new Date().toISOString() })
    .where(eq(lessonComments.id, commentId))
    .returning()
    .get();
}

/**
 * Author, course owner, or admin may delete. Comments with replies are soft
 * deleted (body blanked); others are hard deleted. Hard-deleting the last
 * reply of a soft-deleted parent removes the parent too.
 */
export function deleteComment(
  commentId: number,
  actorUserId: number
): DeleteResult {
  // Synchronous transaction (better-sqlite3): checks and writes see one state.
  return db.transaction((tx): DeleteResult => {
    const getComment = (id: number) =>
      tx.select().from(lessonComments).where(eq(lessonComments.id, id)).get();
    const replyCount = (id: number) =>
      tx
        .select({ count: sql<number>`count(*)` })
        .from(lessonComments)
        .where(eq(lessonComments.parentId, id))
        .get()?.count ?? 0;

    const comment = getComment(commentId);
    if (!comment) {
      throw new CommentError("Comment not found", 404);
    }

    const actor = tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, actorUserId))
      .get();
    if (!actor) {
      throw new CommentError("User not found", 404);
    }

    const ownerId = tx
      .select({ instructorId: courses.instructorId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, comment.lessonId))
      .get()?.instructorId;

    const isAuthor = comment.userId === actorUserId;
    const isAdmin = actor.role === UserRole.Admin;
    const isOwner = ownerId === actorUserId;
    if (!isAuthor && !isAdmin && !isOwner) {
      throw new CommentError("You are not allowed to delete this comment", 403);
    }

    if (comment.deletedAt) {
      throw new CommentError("Comment is already deleted");
    }

    if (replyCount(commentId) > 0) {
      tx.update(lessonComments)
        .set({ deletedAt: new Date().toISOString(), body: "" })
        .where(eq(lessonComments.id, commentId))
        .run();
      return { mode: "soft" };
    }

    tx.delete(lessonComments).where(eq(lessonComments.id, commentId)).run();

    if (comment.parentId !== null) {
      const parent = getComment(comment.parentId);
      if (parent?.deletedAt && replyCount(parent.id) === 0) {
        tx.delete(lessonComments).where(eq(lessonComments.id, parent.id)).run();
      }
    }
    return { mode: "hard" };
  });
}
