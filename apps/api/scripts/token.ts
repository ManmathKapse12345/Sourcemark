// Mints a local HS256 access token for a seeded user, for development and demos only.
// Usage: npm run token -- creator@northfern.test
import "dotenv/config";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const email = process.argv[2];
const secret = process.env.AUTH_JWT_SECRET;
if (!email || !secret) {
  console.error("Usage: npm run token -- <email>   (needs AUTH_JWT_SECRET in apps/api/.env)");
  process.exit(1);
}

const prisma = new PrismaClient();
const user = await prisma.user.findUnique({ where: { email } });
await prisma.$disconnect();
if (!user) {
  console.error(`No user ${email}. Run npm run db:seed first.`);
  process.exit(1);
}

const token = await new SignJWT({ email: user.email, user_metadata: { full_name: user.name } })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setAudience(process.env.AUTH_AUDIENCE ?? "authenticated")
  .setIssuedAt()
  .setExpirationTime("12h")
  .sign(new TextEncoder().encode(secret));

console.log(token);
