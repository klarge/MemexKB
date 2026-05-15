import { createHash } from "node:crypto";
import { type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { apiTokensTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function resolveTokenAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) return false;

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [row] = await db
    .select({
      tokenId: apiTokensTable.id,
      userId: usersTable.id,
      userRole: usersTable.role,
      userName: usersTable.name,
      userEmail: usersTable.email,
      expiresAt: apiTokensTable.expiresAt,
    })
    .from(apiTokensTable)
    .innerJoin(usersTable, eq(apiTokensTable.userId, usersTable.id))
    .where(eq(apiTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!row) return false;
  if (row.expiresAt && row.expiresAt < new Date()) return false;

  // Update last used (fire-and-forget, do not await)
  db.update(apiTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokensTable.id, row.tokenId))
    .catch(() => {});

  // Populate session-like context for this request (in-memory only, not persisted)
  req.session.userId = row.userId;
  req.session.userRole = row.userRole;
  req.session.userName = row.userName;
  req.session.userEmail = row.userEmail;

  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.session?.userId) {
    next();
    return;
  }

  const resolved = await resolveTokenAuth(req);
  if (resolved) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session?.userId) {
    await resolveTokenAuth(req).catch(() => {});
  }
  next();
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session?.userId) {
      const resolved = await resolveTokenAuth(req);
      if (!resolved) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }
    if (!roles.includes(req.session.userRole as string)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

declare module "express-session" {
  interface SessionData {
    userId: number;
    userRole: string;
    userEmail: string;
    userName: string;
  }
}
