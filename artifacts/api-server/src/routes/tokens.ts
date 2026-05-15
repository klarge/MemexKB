import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@workspace/db";
import { apiTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

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

export default router;
