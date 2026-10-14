import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, mobileSsoTable, type MobileSso } from "@workspace/db";
import type { Request, Response } from "express";

export const MOBILE_CALLBACK = "memex-mobile://sso-callback";
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");
export const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function pendingMobile(ticketHash: string, providerId: number) {
  const [pending] = await db.select().from(mobileSsoTable).where(and(
    eq(mobileSsoTable.ticketHash, ticketHash), eq(mobileSsoTable.providerId, providerId),
    eq(mobileSsoTable.started, true), isNull(mobileSsoTable.codeHash),
    gt(mobileSsoTable.expiresAt, new Date()),
  ));
  return pending ?? null;
}

// Persistent SAML correlation survives cross-site POSTs without browser cookies,
// process restarts, and multiple API replicas. Only this transaction's ID matches.
export function mobileSamlCache(pending: MobileSso) {
  return {
    async saveAsync(key: string, value: string) {
      await db.update(mobileSsoTable).set({ samlRequestId: key, samlRequestInstant: value })
        .where(eq(mobileSsoTable.ticketHash, pending.ticketHash));
      return { createdAt: Date.now(), value };
    },
    async getAsync(key: string) {
      const current = await pendingMobile(pending.ticketHash, pending.providerId);
      return current?.samlRequestId === key ? current.samlRequestInstant : null;
    },
    async removeAsync(key: string) {
      const [removed] = await db.update(mobileSsoTable).set({ samlRequestId: null, samlRequestInstant: null })
        .where(and(eq(mobileSsoTable.ticketHash, pending.ticketHash), eq(mobileSsoTable.samlRequestId, key)))
        .returning();
      return removed ? key : null;
    },
  };
}

export async function completeMobile(pending: MobileSso, userId: number, res: Response) {
  const code = opaqueToken();
  const [completed] = await db.update(mobileSsoTable).set({
    codeHash: tokenHash(code), userId, expiresAt: new Date(Date.now() + 60_000),
  }).where(and(
    eq(mobileSsoTable.ticketHash, pending.ticketHash), isNull(mobileSsoTable.codeHash),
    gt(mobileSsoTable.expiresAt, new Date()),
  )).returning();
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (!completed) { res.status(400).send("Sign-in expired or cancelled. Return to Memex and try again."); return; }
  res.redirect(`${MOBILE_CALLBACK}?code=${code}&state=${pending.state}`);
}

export async function establishSsoSession(req: Request, user: { id: number; role: string; email: string; name: string }) {
  await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.userRole = user.role;
  req.session.userEmail = user.email;
  req.session.userName = user.name;
  await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}
