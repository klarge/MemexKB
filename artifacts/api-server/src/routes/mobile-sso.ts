import { Router } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { db, mobileSsoTable, ssoConfigsTable, usersTable } from "@workspace/db";
import { opaqueToken, tokenHash, pkceChallenge, validToken, establishSsoSession } from "../lib/mobile-sso";

const router = Router();
router.use("/auth/mobile", (_req, res, next) => {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  next();
});

router.post("/auth/mobile/start", async (req, res) => {
  const { providerId, challenge, state } = req.body ?? {};
  if (!Number.isSafeInteger(providerId) || providerId < 1 || !validToken(challenge) || !validToken(state) ||
      Object.keys(req.body).some(key => !["providerId", "challenge", "state"].includes(key))) {
    res.status(400).json({ error: "Invalid native sign-in request." }); return;
  }
  const [provider] = await db.select().from(ssoConfigsTable).where(and(eq(ssoConfigsTable.id, providerId), eq(ssoConfigsTable.enabled, true)));
  if (!provider || !["saml", "oidc"].includes(provider.provider)) {
    res.status(404).json({ error: "SSO provider is not available." }); return;
  }
  await db.delete(mobileSsoTable).where(lt(mobileSsoTable.expiresAt, new Date()));
  const ticket = opaqueToken();
  await db.insert(mobileSsoTable).values({
    ticketHash: tokenHash(ticket), providerId, challenge, state, expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  res.json({ ticket });
});

router.get("/auth/mobile/browser", async (req, res) => {
  const ticket = req.query.ticket;
  if (!validToken(ticket) || Object.keys(req.query).some(key => key !== "ticket")) {
    res.status(400).send("Invalid sign-in link."); return;
  }
  const [pending] = await db.update(mobileSsoTable).set({ started: true }).where(and(
    eq(mobileSsoTable.ticketHash, tokenHash(ticket)), eq(mobileSsoTable.started, false),
    gt(mobileSsoTable.expiresAt, new Date()),
  )).returning();
  if (!pending) { res.status(400).send("Sign-in expired or cancelled. Return to Memex and try again."); return; }
  const [provider] = await db.select().from(ssoConfigsTable).where(and(
    eq(ssoConfigsTable.id, pending.providerId), eq(ssoConfigsTable.enabled, true),
  ));
  if (!provider) { res.status(400).send("SSO provider is no longer available."); return; }
  // Carry only the opaque ticket to the existing provider login route.
  res.redirect(`/api/auth/${provider.provider}/${provider.id}/login?mobile=${ticket}`);
});

router.post("/auth/mobile/cancel", async (req, res) => {
  const { ticket, verifier } = req.body ?? {};
  if (!validToken(ticket) || !validToken(verifier)) { res.status(400).json({ error: "Invalid cancellation." }); return; }
  await db.delete(mobileSsoTable).where(and(
    eq(mobileSsoTable.ticketHash, tokenHash(ticket)), eq(mobileSsoTable.challenge, pkceChallenge(verifier)),
  ));
  res.sendStatus(204);
});

router.post("/auth/mobile/exchange", async (req, res) => {
  const { code, verifier, state } = req.body ?? {};
  if (!validToken(code) || !validToken(verifier) || !validToken(state)) {
    res.status(400).json({ error: "Invalid sign-in callback." }); return;
  }
  // Atomic consume: parallel or replayed exchanges cannot create two sessions.
  const [grant] = await db.delete(mobileSsoTable).where(and(
    eq(mobileSsoTable.codeHash, tokenHash(code)), eq(mobileSsoTable.challenge, pkceChallenge(verifier)),
    eq(mobileSsoTable.state, state), gt(mobileSsoTable.expiresAt, new Date()),
  )).returning();
  if (!grant?.userId) { res.status(400).json({ error: "Sign-in expired, cancelled, or already used. Please try again." }); return; }
  const [provider] = await db.select().from(ssoConfigsTable).where(and(eq(ssoConfigsTable.id, grant.providerId), eq(ssoConfigsTable.enabled, true)));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, grant.userId));
  if (!provider || !user) { res.status(400).json({ error: "This sign-in is no longer available." }); return; }
  try {
    await establishSsoSession(req, user);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch {
    req.session?.destroy(() => undefined);
    res.status(500).json({ error: "Unable to create a session. Please try again." });
  }
});

export default router;
