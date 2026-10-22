import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Re-read identity on every protected request. Role changes and deleted accounts
// take effect in existing sessions, not only after the next sign-in.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    req.session.destroy(() => undefined);
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  req.session.userRole = user.role;
  req.session.userName = user.name;
  req.session.userEmail = user.email;
  next();
}
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await requireAuth(req, res, () => {
      if (!roles.includes(req.session.userRole ?? "")) { res.status(403).json({ error: "Forbidden" }); return; }
      next();
    });
  };
}
declare module "express-session" {
  interface SessionData {
    userId: number; userRole: string; userName: string; userEmail: string;
    oidcPending?: { state: string; nonce: string; verifier: string; providerId: number; expiresAt: number };
  }
}
