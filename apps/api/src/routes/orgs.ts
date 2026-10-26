import { AddMemberBody, CreateOrgBody, UpdateMemberBody } from "@sourcemark/contract";
import { Router } from "express";
import { audit } from "../audit.js";
import { member, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { owned } from "../db/scoped.js";
import { conflict, notFound } from "../http/errors.js";
import { param, parseBody } from "../http/validate.js";

// Routes that are not inside an organisation yet.
export function accountRouter() {
  const r = Router();

  r.get("/me", async (req, res) => {
    const memberships = await prisma.member.findMany({
      where: { userId: req.user!.id },
      include: { org: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      user: req.user,
      memberships: memberships.map((m) => ({ memberId: m.id, org: m.org, roles: m.roles })),
    });
  });

  // Whoever creates an organisation becomes its first admin (and can hold other roles too).
  r.post("/orgs", async (req, res) => {
    const body = parseBody(CreateOrgBody, req.body);
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({ data: { name: body.name } });
      const m = await tx.member.create({
        data: { orgId: org.id, userId: req.user!.id, roles: ["ADMIN", "CREATOR", "REVIEWER", "APPROVER"] },
      });
      await audit(tx, { orgId: org.id, actorId: m.id, action: "org.created", entityType: "Organisation", entityId: org.id });
      return { org, member: m };
    });
    res.status(201).json(result);
  });

  return r;
}

// Mounted under /orgs/:orgId after loadMembership.
export function membersRouter() {
  const r = Router({ mergeParams: true });

  r.get("/", async (req, res) => {
    const { orgId } = member(req);
    const [org, members] = await Promise.all([
      prisma.organisation.findUniqueOrThrow({ where: { id: orgId } }),
      prisma.member.findMany({
        where: { orgId },
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    res.json({
      org,
      members: members.map((m) => ({ id: m.id, userId: m.userId, email: m.user.email, name: m.user.name, roles: m.roles })),
    });
  });

  r.post("/members", requireRole("ADMIN"), async (req, res) => {
    const me = member(req);
    const body = parseBody(AddMemberBody, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) throw notFound("User (they need to sign in once before they can be added)");
    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.member.create({ data: { orgId: me.orgId, userId: user.id, roles: body.roles } });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "member.added",
        entityType: "Member",
        entityId: m.id,
        data: { email: user.email, roles: body.roles },
      });
      return m;
    });
    res.status(201).json(created);
  });

  r.patch("/members/:memberId", requireRole("ADMIN"), async (req, res) => {
    const me = member(req);
    const body = parseBody(UpdateMemberBody, req.body);
    const target = owned(await prisma.member.findUnique({ where: { id: param(req.params.memberId, "memberId") } }), me.orgId, "Member");
    if (target.id === me.id && !body.roles.includes("ADMIN")) {
      const admins = await prisma.member.count({ where: { orgId: me.orgId, roles: { has: "ADMIN" } } });
      if (admins <= 1) throw conflict("An organisation needs at least one admin");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.member.update({ where: { id: target.id }, data: { roles: body.roles } });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "member.roles_changed",
        entityType: "Member",
        entityId: m.id,
        data: { from: target.roles, to: body.roles },
      });
      return m;
    });
    res.json(updated);
  });

  r.get("/audit", requireRole("ADMIN"), async (req, res) => {
    const { orgId } = member(req);
    const take = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const entries = await prisma.auditLog.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take });
    res.json({ entries });
  });

  return r;
}
