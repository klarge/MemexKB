import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db, notificationPreferencesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../lib/auth";
import { smtpInputSchema, readSmtpSettings, publicSmtpSettings, saveSmtpSettings, createSmtpTransport, smtpErrorMessage } from "../lib/notification-config";

const router = Router();
export const preferenceInputSchema = z.object({
  cardAssigned: z.boolean(), projectAdded: z.boolean(), cardDue: z.boolean(),
  dueSoonHours: z.number().int().refine(value => [1, 24, 48, 72, 168].includes(value), "Choose a supported reminder time"),
});
const defaultPreferences = { cardAssigned: false, projectAdded: false, cardDue: false, dueSoonHours: 24 };
const testLimiter = rateLimit({ windowMs: 60000, limit: 3, standardHeaders: true, legacyHeaders: false,
  message: { error: "Please wait before sending another test email." } });

router.get("/admin/notifications", requireRole("admin"), async (_req, res) => {
  res.json(publicSmtpSettings(await readSmtpSettings()));
});
router.put("/admin/notifications", requireRole("admin"), async (req, res) => {
  const parsed = smtpInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues.map(issue => issue.message).join("; ") }); return; }
  res.json(publicSmtpSettings(await saveSmtpSettings(parsed.data)));
});
router.post("/admin/notifications/test", requireRole("admin"), testLimiter, async (req, res) => {
  const config = await readSmtpSettings();
  if (!config.enabled) { res.status(400).json({ error: "Enable and save SMTP settings before sending a test." }); return; }
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) { res.status(401).json({ error: "Account not found" }); return; }
  let transport: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    transport = createSmtpTransport(config);
    const result = await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail }, to: user.email,
      subject: "Notification email test",
      text: `Your SMTP notification settings are working.\n\n${config.appUrl}`,
    });
    if (!result.accepted?.length) throw new Error("Recipient was not accepted");
    res.json({ message: "Test email accepted by the SMTP server. Check your inbox and spam folder." });
  } catch (error) { res.status(502).json({ error: smtpErrorMessage(error) }); }
  finally { transport?.close(); }
});
router.get("/me/notifications", requireAuth, async (req, res) => {
  const [preferences] = await db.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, req.session.userId!));
  const { userId: _, ...fields } = preferences ?? { userId: req.session.userId!, ...defaultPreferences };
  res.json({ ...fields, emailAvailable: (await readSmtpSettings()).enabled });
});
router.put("/me/notifications", requireAuth, async (req, res) => {
  const parsed = preferenceInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide all notification switches and a valid reminder time." }); return; }
  const [preferences] = await db.insert(notificationPreferencesTable).values({ userId: req.session.userId!, ...parsed.data })
    .onConflictDoUpdate({ target: notificationPreferencesTable.userId, set: parsed.data }).returning();
  const { userId: _, ...fields } = preferences;
  res.json({ ...fields, emailAvailable: (await readSmtpSettings()).enabled });
});
export default router;
