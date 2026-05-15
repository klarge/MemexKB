import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@workspace/db";
import { apiTokensTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();

router.get("/auth/tokens", requireAuth, async (req, res) => {
  const userId = req.session.userId as number;
  const tokens = await db
    .select({
      id: apiTokensTable.id,
      name: apiTokensTable.name,
      lastUsedAt: apiTokensTable.lastUsedAt,
      expiresAt: apiTokensTable.expiresAt,
      createdAt: apiTokensTable.createdAt,
    })
    .from(apiTokensTable)
    .where(eq(apiTokensTable.userId, userId));
  res.json(tokens);
});

router.post("/auth/tokens", requireAuth, async (req, res) => {
  const userId = req.session.userId as number;
  const { name, expiresAt } = req.body as { name?: unknown; expiresAt?: unknown };
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Token name is required" });
    return;
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [token] = await db
    .insert(apiTokensTable)
    .values({
      userId,
      name: name.trim(),
      tokenHash,
      expiresAt: expiresAt ? new Date(expiresAt as string) : null,
    })
    .returning({
      id: apiTokensTable.id,
      name: apiTokensTable.name,
      createdAt: apiTokensTable.createdAt,
      expiresAt: apiTokensTable.expiresAt,
    });

  res.status(201).json({
    ...token,
    token: rawToken,
    message: "Save this token securely — it will not be shown again.",
  });
});

router.delete("/auth/tokens/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId as number;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid token ID" });
    return;
  }

  await db
    .delete(apiTokensTable)
    .where(and(eq(apiTokensTable.id, id), eq(apiTokensTable.userId, userId)));

  res.json({ message: "Token revoked" });
});

// ─── Admin: view and revoke all tokens ───────────────────────────────────────

router.get("/admin/tokens", requireAuth, requireRole("admin"), async (_req, res) => {
  const rows = await db
    .select({
      id: apiTokensTable.id,
      name: apiTokensTable.name,
      lastUsedAt: apiTokensTable.lastUsedAt,
      expiresAt: apiTokensTable.expiresAt,
      createdAt: apiTokensTable.createdAt,
      userId: apiTokensTable.userId,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(apiTokensTable)
    .leftJoin(usersTable, eq(apiTokensTable.userId, usersTable.id))
    .orderBy(apiTokensTable.createdAt);
  res.json(rows);
});

router.delete("/admin/tokens/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid token ID" });
    return;
  }
  const deleted = await db.delete(apiTokensTable).where(eq(apiTokensTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Token not found" });
    return;
  }
  res.json({ message: "Token revoked" });
});

export default router;
