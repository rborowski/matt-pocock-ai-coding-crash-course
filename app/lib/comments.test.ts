import { describe, it, expect } from "vitest";
import { canParticipateInComments, COMMENT_MAX_LENGTH } from "./comments";
import { UserRole } from "~/db/schema";

const base = {
  role: UserRole.Student,
  isCourseOwner: false,
  isEnrolled: false,
  isPppBlocked: false,
};

describe("canParticipateInComments", () => {
  it("exposes the max length", () => expect(COMMENT_MAX_LENGTH).toBe(2000));
  it("allows enrolled student", () =>
    expect(canParticipateInComments({ ...base, isEnrolled: true })).toBe(true));
  it("denies non-enrolled student", () =>
    expect(canParticipateInComments(base)).toBe(false));
  it("denies PPP-blocked enrolled student", () =>
    expect(
      canParticipateInComments({ ...base, isEnrolled: true, isPppBlocked: true })
    ).toBe(false));
  it("allows course owner without enrollment", () =>
    expect(
      canParticipateInComments({
        ...base,
        role: UserRole.Instructor,
        isCourseOwner: true,
      })
    ).toBe(true));
  it("denies non-owner instructor who is not enrolled", () =>
    expect(
      canParticipateInComments({ ...base, role: UserRole.Instructor })
    ).toBe(false));
  it("treats enrolled non-owner instructor like a student", () => {
    const i = { ...base, role: UserRole.Instructor, isEnrolled: true };
    expect(canParticipateInComments(i)).toBe(true);
    expect(canParticipateInComments({ ...i, isPppBlocked: true })).toBe(false);
  });
  it("allows admin regardless", () =>
    expect(
      canParticipateInComments({ ...base, role: UserRole.Admin, isPppBlocked: true })
    ).toBe(true));
});
