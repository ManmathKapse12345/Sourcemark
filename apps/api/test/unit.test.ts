import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/content/applyEdits.js";
import { HttpError } from "../src/http/errors.js";
import { availableActions, planTransition } from "../src/workflow/stateMachine.js";

const creator = { roles: ["CREATOR" as const], isAuthor: true };
const approver = { roles: ["APPROVER" as const], isAuthor: false };
const reviewer = { roles: ["REVIEWER" as const], isAuthor: false };

describe("workflow state machine", () => {
  it("follows the planned path", () => {
    expect(planTransition("DRAFT", "SUBMIT", creator)).toBe("CHECKING");
    expect(planTransition("CHECKING", "RESOLVE", creator)).toBe("IN_REVIEW");
    expect(planTransition("IN_REVIEW", "REQUEST_CHANGES", reviewer)).toBe("CHANGES_REQUESTED");
    expect(planTransition("CHANGES_REQUESTED", "REVISE", creator)).toBe("DRAFT");
    expect(planTransition("IN_REVIEW", "APPROVE", approver)).toBe("APPROVED");
    expect(planTransition("IN_REVIEW", "REJECT", approver)).toBe("REJECTED");
  });

  it("never lets an author approve their own content, even as an approver", () => {
    const authorApprover = { roles: ["CREATOR" as const, "APPROVER" as const], isAuthor: true };
    expect(() => planTransition("IN_REVIEW", "APPROVE", authorApprover)).toThrow(HttpError);
    expect(() => planTransition("IN_REVIEW", "APPROVE", reviewer)).toThrow(/approver/);
  });

  it("rejects transitions from the wrong state with a conflict", () => {
    try {
      planTransition("APPROVED", "SUBMIT", creator);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(409);
    }
  });

  it("lists what each person can do", () => {
    expect(availableActions("IN_REVIEW", approver).sort()).toEqual(["APPROVE", "REJECT", "REQUEST_CHANGES"]);
    expect(availableActions("IN_REVIEW", creator)).toEqual([]);
  });
});

describe("applyEdits", () => {
  const e = (start: number, end: number, replacement: string) => ({ start, end, replacement, label: `${start}-${end}` });

  it("applies several edits using original offsets", () => {
    expect(applyEdits("Our Cream is a MIRACLE!!", [e(4, 9, "Moisturiser"), e(15, 22, "comfort"), e(22, 24, ".")])).toBe(
      "Our Moisturiser is a comfort.",
    );
  });

  it("supports insertion at the start", () => {
    expect(applyEdits("Loving it", [e(0, 0, "#ad ")])).toBe("#ad Loving it");
  });

  it("applies an identical edit from two findings once", () => {
    expect(applyEdits("Our Cream", [e(4, 9, "Moisturiser"), e(4, 9, "Moisturiser")])).toBe("Our Moisturiser");
  });

  it("refuses overlapping edits", () => {
    expect(() => applyEdits("Our Cream is great", [e(4, 9, "A"), e(0, 12, "B")])).toThrow(/same text/);
  });
});
