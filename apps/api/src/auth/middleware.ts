import type { Role } from "@prisma/client";
import type { RequestHandler } from "express";
import { prisma } from "../db.js";
import { forbidden, HttpError, notFound } from "../http/errors.js";
import type { TokenVerifier } from "./tokens.js";

export function authenticate(verify: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "unauthenticated", "Missing bearer token");

    let claims;
    try {
      claims = await verify(token);
    } catch {
      throw new HttpError(401, "unauthenticated", "Invalid or expired token");
    }

    // Users are created on first sign-in so admins can add them to organisations by email.
    const user =
      (await prisma.user.findUnique({ where: { id: claims.sub } })) ??
      (await prisma.user.create({ data: { id: claims.sub, email: claims.email, name: claims.name } }));
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  };
}

// Mounted on /orgs/:orgId. Non-members get 404 so organisation ids cannot be probed.
export const loadMembership: RequestHandler = async (req, _res, next) => {
  const orgId = req.params.orgId;
  if (!req.user || typeof orgId !== "string") throw notFound("Organisation");
  const member = await prisma.member.findUnique({
    where: { orgId_userId: { orgId, userId: req.user.id } },
  });
  if (!member) throw notFound("Organisation");
  req.member = { id: member.id, orgId: member.orgId, userId: member.userId, roles: member.roles };
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.member?.roles.some((r) => roles.includes(r))) {
      throw forbidden(`Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
}

export function member(req: Express.Request) {
  if (!req.member) throw new Error("loadMembership did not run");
  return req.member;
}
