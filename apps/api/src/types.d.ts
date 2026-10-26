import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string | null };
      member?: { id: string; orgId: string; userId: string; roles: Role[] };
    }
  }
}

export {};
