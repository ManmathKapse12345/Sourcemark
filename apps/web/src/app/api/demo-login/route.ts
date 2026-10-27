import { SignJWT } from "jose";

// Demo-only sign-in for the seeded Northfern accounts (apps/api/prisma/seed.ts).
// Enabled only when DEMO_AUTH_SECRET is set on the server; it must equal the API's AUTH_JWT_SECRET.
const DEMO_USERS: Record<string, { id: string; email: string; name: string }> = {
  creator: { id: "00000000-0000-4000-8000-000000000002", email: "creator@northfern.test", name: "Chirag (Creator)" },
  reviewer: { id: "00000000-0000-4000-8000-000000000003", email: "reviewer@northfern.test", name: "Ritu (Reviewer)" },
  approver: { id: "00000000-0000-4000-8000-000000000004", email: "approver@northfern.test", name: "Arjun (Approver)" },
  admin: { id: "00000000-0000-4000-8000-000000000001", email: "admin@northfern.test", name: "Asha (Admin)" },
};

export async function POST(req: Request) {
  const secret = process.env.DEMO_AUTH_SECRET;
  if (!secret) return Response.json({ error: { message: "Demo sign-in is turned off" } }, { status: 404 });
  const { role } = (await req.json().catch(() => ({}))) as { role?: string };
  const u = role ? DEMO_USERS[role] : undefined;
  if (!u) return Response.json({ error: { message: "Unknown demo account" } }, { status: 400 });
  const token = await new SignJWT({ email: u.email, user_metadata: { full_name: u.name } })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));
  return Response.json({ token });
}
