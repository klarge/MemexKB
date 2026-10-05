import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, count, and, gt, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { requireAuth } from "../lib/auth";
import { SSO_ONLY_PASSWORD_MESSAGE } from "../lib/login-mode";

const router = Router();

// Returns whether initial setup (first admin account) is still needed.
// Safe to call unauthenticated — only reveals a boolean count check.
router.get("/auth/setup-status", async (_req, res) => {
  const [result] = await db.select({ c: count() }).from(usersTable);
  res.json({ needsSetup: Number(result?.c ?? 0) === 0 });
});

// Creates the very first admin account.  Fails with 409 if any user already exists.
router.post("/auth/setup", async (req, res) => {
  const [result] = await db.select({ c: count() }).from(usersTable);
  if (Number(result?.c ?? 0) > 0) {
    res.status(409).json({ error: "Setup has already been completed." });
    return;
  }

  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email, and password are required." });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ name: name.trim(), email: email.trim().toLowerCase(), passwordHash, role: "admin" })
    .returning();

  // Regenerate the session ID before writing identity to prevent session fixation.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      res.status(500).json({ error: "Failed to create session" });
      return;
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userEmail = user.email;
    req.session.userName = user.name;

    req.session.save((saveErr) => {
      if (saveErr) {
        res.status(500).json({ error: "Failed to create session" });
        return;
      }
      res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, ssoOnly: user.ssoOnly });
    });
  });
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  // Always run bcrypt to prevent user-enumeration via timing differences.
  const DUMMY_HASH = "$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const passwordOk = await bcrypt.compare(password, user && !user.ssoOnly ? user.passwordHash : DUMMY_HASH);
  if (!user || user.ssoOnly || !passwordOk) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (user.mustResetPassword) {
    res.status(403).json({ error: "This account needs a password reset. Use the recovery link supplied by an administrator." });
    return;
  }

  try {
    const [current] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (!current || current.ssoOnly || current.mustResetPassword || current.passwordHash !== user.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" }); return;
    }
    // Session storage uses the database pool too: never hold a transaction
    // connection while waiting for regenerate/save, or pool exhaustion deadlocks.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => {
        if (error) { reject(error); return; }
        req.session.userId = current.id;
        req.session.userRole = current.role;
        req.session.userEmail = current.email;
        req.session.userName = current.name;
        req.session.save((saveError) => saveError ? reject(saveError) : resolve());
      });
    });
    // Revalidate after persistence as well. A mode/password/role change during
    // bcrypt or session-store I/O must revoke this attempted password session.
    const [latest] = await db.select().from(usersTable).where(eq(usersTable.id, current.id));
    if (!latest || latest.ssoOnly || latest.mustResetPassword || latest.passwordHash !== current.passwordHash || latest.role !== current.role) {
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      res.status(401).json({ error: "Invalid email or password" }); return;
    }
    res.json({ id: latest.id, email: latest.email, name: latest.name, role: latest.role, ssoOnly: latest.ssoOnly });
  } catch {
    req.session?.destroy(() => undefined);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

router.post("/auth/recovery/reset", async (req, res): Promise<void> => {
  const { token, newPassword } = req.body as { token?: unknown; newPassword?: unknown };
  if (typeof token !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "A valid recovery token and a password of at least 8 characters are required." });
    return;
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const reset = await db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));
    if (!candidate) return null;
    // Lock in the same order as administrator edits: user first, then token.
    const [account] = await tx.select().from(usersTable).where(eq(usersTable.id, candidate.userId)).for("update");
    if (!account || account.ssoOnly) return null;
    const [claimed] = await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ))
      .returning();
    if (!claimed) return null;
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await tx
      .update(usersTable)
      .set({ passwordHash, mustResetPassword: false, updatedAt: new Date() })
      .where(and(eq(usersTable.id, claimed.userId), eq(usersTable.ssoOnly, false)));
    return claimed;
  });
  if (!reset) {
    res.status(400).json({ error: "This recovery link is invalid, expired, or has already been used." });
    return;
  }
  res.json({ message: "Password set. You can now sign in." });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId!))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, ssoOnly: user.ssoOnly });
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Both passwords required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId!))
    .limit(1);

  if (user?.ssoOnly) { res.status(403).json({ error: SSO_ONLY_PASSWORD_MESSAGE }); return; }
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const changed = await db
    .update(usersTable)
    .set({ passwordHash })
    .where(and(eq(usersTable.id, user.id), eq(usersTable.ssoOnly, false)))
    .returning({ id: usersTable.id });
  if (!changed.length) { res.status(403).json({ error: SSO_ONLY_PASSWORD_MESSAGE }); return; }

  // Rotate the session ID after a password change so that any stolen session
  // cookie from before the change can no longer be used.  Fail closed: if
  // rotation or save fails, destroy the existing session so the pre-change
  // cookie cannot be reused.  The user must log in again.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.session.destroy(() => {
        res.status(500).json({ error: "Password changed but session rotation failed. Please log in again." });
      });
      return;
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.save((saveErr) => {
      if (saveErr) {
        req.session.destroy(() => {
          res.status(500).json({ error: "Password changed but session save failed. Please log in again." });
        });
        return;
      }
      res.json({ message: "Password changed successfully" });
    });
  });
});

export default router;
