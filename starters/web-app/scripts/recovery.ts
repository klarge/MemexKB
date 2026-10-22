import { randomBytes, createHash } from "node:crypto";
import { db, pool, usersTable, passwordResetTokensTable } from "../db";
import { eq } from "drizzle-orm";
// Infrastructure access is required. Never creates a fixed password, changes
// roles, or downgrades SSO-only users. Token is single-use and short lived.
try {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !process.env.APP_BASE_URL) throw Error("Usage: pnpm admin:recovery <admin-email>; configure APP_BASE_URL first.");
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || user.role !== "admin" || user.ssoOnly) throw Error("Recovery requires an existing password-enabled administrator. Repair the identity provider for SSO-only accounts.");
  const token = randomBytes(32).toString("hex");
  await db.transaction(async tx => {
    await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));
    await tx.insert(passwordResetTokensTable).values({ userId:user.id, tokenHash:createHash("sha256").update(token).digest("hex"), expiresAt:new Date(Date.now()+30*60_000) });
  });
  process.stdout.write(`${process.env.APP_BASE_URL.replace(/\/$/, "")}/recovery?token=${token}\nTreat this single-use URL as a password. Expires in 30 minutes.\n`);
} finally { await pool.end(); }
