import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let currentCountry: string | null = null;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/country.server", () => ({
  resolveCountry: async () => currentCountry,
}));

import { getCommentAccess } from "./commentAccessService";

const request = new Request("http://localhost/");

function makeUser(name: string, role = schema.UserRole.Student) {
  return testDb
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function enroll(userId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function courseArg(overrides: Partial<{ price: number; pppEnabled: boolean }> = {}) {
  return {
    id: base.course.id,
    instructorId: base.course.instructorId,
    price: overrides.price ?? base.course.price,
    pppEnabled: overrides.pppEnabled ?? base.course.pppEnabled,
  };
}

describe("getCommentAccess", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    currentCountry = null;
  });

  it("denies anonymous and unknown users", async () => {
    expect((await getCommentAccess(request, null, courseArg())).canComment).toBe(false);
    expect((await getCommentAccess(request, 9999, courseArg())).canComment).toBe(false);
  });

  it("lets an admin comment without enrolling, as moderator", async () => {
    const admin = makeUser("admin", schema.UserRole.Admin);
    expect(await getCommentAccess(request, admin.id, courseArg())).toMatchObject({
      canComment: true,
      isModerator: true,
      enrolled: false,
    });
  });

  it("lets the course owner comment without enrolling, as moderator", async () => {
    expect(
      await getCommentAccess(request, base.instructor.id, courseArg())
    ).toMatchObject({ canComment: true, isModerator: true, enrolled: false });
  });

  it("denies a non-owner instructor who is not enrolled", async () => {
    const inst = makeUser("inst2", schema.UserRole.Instructor);
    expect(await getCommentAccess(request, inst.id, courseArg())).toMatchObject({
      canComment: false,
      isModerator: false,
    });
  });

  it("lets an enrolled student comment, not as moderator", async () => {
    enroll(base.user.id);
    expect(await getCommentAccess(request, base.user.id, courseArg())).toMatchObject({
      canComment: true,
      isModerator: false,
      enrolled: true,
      pppBlocked: false,
    });
  });

  it("denies a non-enrolled student", async () => {
    expect(await getCommentAccess(request, base.user.id, courseArg())).toMatchObject({
      canComment: false,
      isModerator: false,
      enrolled: false,
    });
  });

  it("denies an enrolled student who is PPP-blocked", async () => {
    enroll(base.user.id);
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 2000,
        country: "IN",
      })
      .run();
    currentCountry = "US";
    const course = courseArg({ price: 10000, pppEnabled: true });
    expect(await getCommentAccess(request, base.user.id, course)).toMatchObject({
      canComment: false,
      enrolled: true,
      pppBlocked: true,
    });

    // Same country as the purchase: allowed again.
    currentCountry = "IN";
    expect(await getCommentAccess(request, base.user.id, course)).toMatchObject({
      canComment: true,
      pppBlocked: false,
    });
  });
});
