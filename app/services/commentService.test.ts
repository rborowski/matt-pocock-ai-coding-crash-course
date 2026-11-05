import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: { id: number };
let otherLesson: { id: number };

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  createComment,
  editComment,
  deleteComment,
  getCommentById,
  getLessonCommentThreads,
  countVisibleLessonComments,
  CommentError,
  type VisibleComment,
} from "./commentService";

function makeUser(name: string, role = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function makeLesson(moduleId: number, position: number) {
  return testDb
    .insert(schema.lessons)
    .values({ moduleId, title: `L${position}`, position })
    .returning()
    .get();
}

describe("commentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    const mod = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "M", position: 1 })
      .returning()
      .get();
    lesson = makeLesson(mod.id, 1);
    otherLesson = makeLesson(mod.id, 2);
  });

  describe("body validation", () => {
    it("rejects empty and whitespace-only bodies", () => {
      expect(() => createComment(lesson.id, base.user.id, "", null)).toThrowError(
        "Comment cannot be empty"
      );
      expect(() =>
        createComment(lesson.id, base.user.id, " \n\t ", null)
      ).toThrowError("Comment cannot be empty");
    });

    it("accepts exactly 2000 chars and rejects 2001", () => {
      expect(
        createComment(lesson.id, base.user.id, "a".repeat(2000), null).body
      ).toHaveLength(2000);
      expect(() =>
        createComment(lesson.id, base.user.id, "a".repeat(2001), null)
      ).toThrowError("at most 2000");
    });

    it("measures length after trimming", () => {
      const c = createComment(
        lesson.id,
        base.user.id,
        `  ${"a".repeat(2000)}  `,
        null
      );
      expect(c.body).toHaveLength(2000);
    });

    it("trims and preserves inner newlines", () => {
      const c = createComment(lesson.id, base.user.id, "  hi\n\nthere \n", null);
      expect(c.body).toBe("hi\n\nthere");
    });

    it("rejects unknown lesson", () => {
      expect(() => createComment(9999, base.user.id, "x", null)).toThrowError(
        "Lesson not found"
      );
    });
  });

  describe("reply rules", () => {
    it("allows reply to a top-level comment", () => {
      const top = createComment(lesson.id, base.user.id, "top", null);
      const reply = createComment(lesson.id, base.user.id, "re", top.id);
      expect(reply.parentId).toBe(top.id);
    });

    it("rejects reply to a reply", () => {
      const top = createComment(lesson.id, base.user.id, "top", null);
      const reply = createComment(lesson.id, base.user.id, "re", top.id);
      expect(() =>
        createComment(lesson.id, base.user.id, "rere", reply.id)
      ).toThrowError("Cannot reply to a reply");
    });

    it("rejects reply to another lesson's comment", () => {
      const top = createComment(otherLesson.id, base.user.id, "top", null);
      expect(() =>
        createComment(lesson.id, base.user.id, "re", top.id)
      ).toThrowError("Parent comment not found in this lesson");
    });

    it("rejects reply to a nonexistent parent", () => {
      expect(() =>
        createComment(lesson.id, base.user.id, "re", 9999)
      ).toThrowError("Parent comment not found");
    });

    it("rejects reply to a soft-deleted comment", () => {
      const top = createComment(lesson.id, base.user.id, "top", null);
      createComment(lesson.id, base.user.id, "re", top.id);
      deleteComment(top.id, base.user.id);
      expect(() =>
        createComment(lesson.id, base.user.id, "re2", top.id)
      ).toThrowError("deleted comment");
    });
  });

  describe("editComment", () => {
    it("lets the author edit and sets editedAt", () => {
      const c = createComment(lesson.id, base.user.id, "old", null);
      expect(c.editedAt).toBeNull();
      const e = editComment(c.id, base.user.id, "  new ");
      expect(e.body).toBe("new");
      expect(e.editedAt).not.toBeNull();
    });

    it("validates the new body", () => {
      const c = createComment(lesson.id, base.user.id, "old", null);
      expect(() => editComment(c.id, base.user.id, "  ")).toThrowError(
        "cannot be empty"
      );
    });

    it("rejects non-authors including admin and course owner", () => {
      const admin = makeUser("admin", schema.UserRole.Admin);
      const other = makeUser("other");
      const c = createComment(lesson.id, base.user.id, "old", null);
      for (const id of [admin.id, base.instructor.id, other.id]) {
        expect(() => editComment(c.id, id, "hax")).toThrowError(
          "Only the author"
        );
      }
      expect(getCommentById(c.id)!.body).toBe("old");
    });

    it("rejects editing a deleted comment", () => {
      const c = createComment(lesson.id, base.user.id, "old", null);
      createComment(lesson.id, base.user.id, "re", c.id);
      deleteComment(c.id, base.user.id);
      expect(() => editComment(c.id, base.user.id, "x")).toThrowError(
        "deleted"
      );
    });

    it("rejects unknown comment", () => {
      expect(() => editComment(9999, base.user.id, "x")).toThrowError(
        "Comment not found"
      );
    });
  });

  describe("typed errors", () => {
    it("throws CommentError with a status for rule violations", () => {
      const other = makeUser("other");
      const c = createComment(lesson.id, base.user.id, "x", null);
      expect(() => createComment(lesson.id, base.user.id, " ")).toThrow(
        CommentError
      );
      expect(() => editComment(9999, base.user.id, "x")).toThrow(CommentError);
      expect(() => deleteComment(c.id, other.id)).toThrow(CommentError);
      try {
        deleteComment(c.id, other.id);
      } catch (e) {
        expect((e as CommentError).status).toBe(403);
        expect((e as CommentError).name).toBe("CommentError");
      }
      try {
        editComment(9999, base.user.id, "x");
      } catch (e) {
        expect((e as CommentError).status).toBe(404);
      }
    });
  });

  describe("deleteComment", () => {
    it("lets author, owner and admin delete", () => {
      const admin = makeUser("admin", schema.UserRole.Admin);
      for (const actor of [base.user.id, base.instructor.id, admin.id]) {
        const c = createComment(lesson.id, base.user.id, "x", null);
        expect(deleteComment(c.id, actor)).toEqual({ mode: "hard" });
        expect(getCommentById(c.id)).toBeUndefined();
      }
    });

    it("rejects other students and non-owner instructors", () => {
      const other = makeUser("other");
      const inst = makeUser("inst2", schema.UserRole.Instructor);
      const c = createComment(lesson.id, base.user.id, "x", null);
      expect(() => deleteComment(c.id, other.id)).toThrowError("not allowed");
      expect(() => deleteComment(c.id, inst.id)).toThrowError("not allowed");
      expect(getCommentById(c.id)).toBeDefined();
    });

    it("rejects unknown comment or actor", () => {
      const c = createComment(lesson.id, base.user.id, "x", null);
      expect(() => deleteComment(9999, base.user.id)).toThrowError(
        "Comment not found"
      );
      expect(() => deleteComment(c.id, 9999)).toThrowError("User not found");
    });

    it("soft deletes a comment with replies and blanks the body", () => {
      const top = createComment(lesson.id, base.user.id, "secret", null);
      createComment(lesson.id, base.user.id, "re", top.id);
      expect(deleteComment(top.id, base.user.id)).toEqual({ mode: "soft" });
      const row = getCommentById(top.id)!;
      expect(row.deletedAt).not.toBeNull();
      expect(row.body).toBe("");
    });

    it("rejects deleting an already soft-deleted comment", () => {
      const top = createComment(lesson.id, base.user.id, "x", null);
      createComment(lesson.id, base.user.id, "re", top.id);
      deleteComment(top.id, base.user.id);
      expect(() => deleteComment(top.id, base.user.id)).toThrowError(
        "already deleted"
      );
    });

    it("removes a soft-deleted parent when its last reply is hard-deleted", () => {
      const top = createComment(lesson.id, base.user.id, "x", null);
      const r1 = createComment(lesson.id, base.user.id, "r1", top.id);
      const r2 = createComment(lesson.id, base.user.id, "r2", top.id);
      deleteComment(top.id, base.user.id);
      deleteComment(r1.id, base.user.id);
      expect(getCommentById(top.id)).toBeDefined();
      deleteComment(r2.id, base.user.id);
      expect(getCommentById(top.id)).toBeUndefined();
    });

    it("keeps a live parent when its last reply is deleted", () => {
      const top = createComment(lesson.id, base.user.id, "x", null);
      const r = createComment(lesson.id, base.user.id, "r", top.id);
      deleteComment(r.id, base.user.id);
      expect(getCommentById(top.id)).toBeDefined();
    });
  });

  describe("listing", () => {
    function setCreatedAt(id: number, iso: string) {
      testDb
        .update(schema.lessonComments)
        .set({ createdAt: iso })
        .where(eq(schema.lessonComments.id, id))
        .run();
    }

    it("returns threads oldest first with replies oldest first", () => {
      const a = createComment(lesson.id, base.user.id, "a", null);
      const b = createComment(lesson.id, base.user.id, "b", null);
      const r1 = createComment(lesson.id, base.user.id, "r1", a.id);
      const r2 = createComment(lesson.id, base.user.id, "r2", a.id);
      setCreatedAt(a.id, "2024-01-01T00:00:00.000Z");
      setCreatedAt(b.id, "2024-01-02T00:00:00.000Z");
      setCreatedAt(r1.id, "2024-01-04T00:00:00.000Z");
      setCreatedAt(r2.id, "2024-01-03T00:00:00.000Z");

      const threads = getLessonCommentThreads(lesson.id);
      expect(threads.map((t) => t.comment.id)).toEqual([a.id, b.id]);
      expect(threads[0].replies.map((r) => r.id)).toEqual([r2.id, r1.id]);
      expect(threads[1].replies).toEqual([]);
    });

    it("only includes the requested lesson", () => {
      createComment(otherLesson.id, base.user.id, "elsewhere", null);
      expect(getLessonCommentThreads(lesson.id)).toEqual([]);
    });

    it("includes author details", () => {
      createComment(lesson.id, base.user.id, "hi", null);
      const c = getLessonCommentThreads(lesson.id)[0].comment as VisibleComment;
      expect(c.deleted).toBe(false);
      expect(c.author).toMatchObject({
        id: base.user.id,
        name: "Test User",
        avatarUrl: null,
        badge: null,
      });
      expect(c.author).not.toHaveProperty("role");
      expect(c.edited).toBe(false);
    });

    it("flags edited comments", () => {
      const c = createComment(lesson.id, base.user.id, "hi", null);
      editComment(c.id, base.user.id, "hi2");
      const item = getLessonCommentThreads(lesson.id)[0].comment as VisibleComment;
      expect(item.edited).toBe(true);
    });

    it("assigns instructor and admin badges", () => {
      const admin = makeUser("admin", schema.UserRole.Admin);
      const otherInst = makeUser("inst2", schema.UserRole.Instructor);
      createComment(lesson.id, base.instructor.id, "o", null);
      createComment(lesson.id, admin.id, "a", null);
      createComment(lesson.id, otherInst.id, "i", null);
      createComment(lesson.id, base.user.id, "s", null);
      const badges = getLessonCommentThreads(lesson.id).map(
        (t) => (t.comment as VisibleComment).author.badge
      );
      expect(badges).toEqual(["instructor", "admin", null, null]);
    });

    it("returns soft-deleted comments as placeholders", () => {
      const top = createComment(lesson.id, base.user.id, "secret", null);
      createComment(lesson.id, base.user.id, "re", top.id);
      deleteComment(top.id, base.user.id);
      const t = getLessonCommentThreads(lesson.id)[0];
      expect(t.comment).toEqual({
        id: top.id,
        lessonId: lesson.id,
        parentId: null,
        deleted: true,
        createdAt: top.createdAt,
      });
      expect(t.replies).toHaveLength(1);
      expect(t.comment).not.toHaveProperty("body");
      expect(t.comment).not.toHaveProperty("author");
      expect(getCommentById(top.id)!.body).toBe("");
    });

    it("counts only visible comments", () => {
      expect(countVisibleLessonComments(lesson.id)).toBe(0);
      const top = createComment(lesson.id, base.user.id, "a", null);
      createComment(lesson.id, base.user.id, "r", top.id);
      createComment(otherLesson.id, base.user.id, "z", null);
      expect(countVisibleLessonComments(lesson.id)).toBe(2);
      deleteComment(top.id, base.user.id);
      expect(countVisibleLessonComments(lesson.id)).toBe(1);
    });
  });

  describe("cascade", () => {
    it("removes comments (including replies) when the lesson is deleted", () => {
      const top = createComment(lesson.id, base.user.id, "a", null);
      createComment(lesson.id, base.user.id, "r", top.id);
      testDb.delete(schema.lessons).where(eq(schema.lessons.id, lesson.id)).run();
      expect(testDb.select().from(schema.lessonComments).all()).toHaveLength(0);
    });

    it("removes comments when the user is deleted", () => {
      createComment(lesson.id, base.user.id, "a", null);
      testDb.delete(schema.users).where(eq(schema.users.id, base.user.id)).run();
      expect(testDb.select().from(schema.lessonComments).all()).toHaveLength(0);
    });

    it("removes replies when the parent row is deleted", () => {
      const top = createComment(lesson.id, base.user.id, "a", null);
      createComment(lesson.id, base.user.id, "r", top.id);
      testDb
        .delete(schema.lessonComments)
        .where(eq(schema.lessonComments.id, top.id))
        .run();
      expect(testDb.select().from(schema.lessonComments).all()).toHaveLength(0);
    });
  });
});
