import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

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
      res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
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
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

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
      res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
    });
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
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
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
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

  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({ passwordHash })
    .where(eq(usersTable.id, user.id));

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
