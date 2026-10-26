import type { ContentState, Role, TransitionAction } from "@prisma/client";
import { conflict, forbidden } from "../http/errors.js";

export interface Actor {
  roles: Role[];
  isAuthor: boolean;
}

interface Transition {
  from: ContentState[];
  to: ContentState;
  allowed: (a: Actor) => boolean;
  rule: string;
}

const has = (a: Actor, ...roles: Role[]) => a.roles.some((r) => roles.includes(r));

// The only state changes the server accepts. The analysis service never appears here:
// AI explains and suggests, people move content between states.
export const TRANSITIONS: Record<TransitionAction, Transition> = {
  SUBMIT: {
    from: ["DRAFT"],
    to: "CHECKING",
    allowed: (a) => a.isAuthor,
    rule: "Only the author can submit",
  },
  RESOLVE: {
    from: ["CHECKING"],
    to: "IN_REVIEW",
    allowed: (a) => a.isAuthor,
    rule: "Only the author can send resolved content to review",
  },
  REQUEST_CHANGES: {
    from: ["IN_REVIEW"],
    to: "CHANGES_REQUESTED",
    allowed: (a) => !a.isAuthor && has(a, "REVIEWER", "APPROVER"),
    rule: "A reviewer or approver other than the author can request changes",
  },
  APPROVE: {
    from: ["IN_REVIEW"],
    to: "APPROVED",
    allowed: (a) => !a.isAuthor && has(a, "APPROVER"),
    rule: "Only an approver other than the author can approve",
  },
  REJECT: {
    from: ["IN_REVIEW"],
    to: "REJECTED",
    allowed: (a) => !a.isAuthor && has(a, "APPROVER"),
    rule: "Only an approver other than the author can reject",
  },
  REVISE: {
    from: ["CHANGES_REQUESTED"],
    to: "DRAFT",
    allowed: (a) => a.isAuthor,
    rule: "Only the author can revise",
  },
};

export function planTransition(state: ContentState, action: TransitionAction, actor: Actor): ContentState {
  const t = TRANSITIONS[action];
  if (!t.from.includes(state)) {
    throw conflict(`Cannot ${action} content that is ${state}`, { state, allowedFrom: t.from });
  }
  if (!t.allowed(actor)) throw forbidden(t.rule);
  return t.to;
}

export function availableActions(state: ContentState, actor: Actor): TransitionAction[] {
  return (Object.keys(TRANSITIONS) as TransitionAction[]).filter(
    (a) => TRANSITIONS[a].from.includes(state) && TRANSITIONS[a].allowed(actor),
  );
}

// Content can be edited (new versions) only while the author is working on it.
export const EDITABLE_STATES: ContentState[] = ["DRAFT", "CHECKING"];
