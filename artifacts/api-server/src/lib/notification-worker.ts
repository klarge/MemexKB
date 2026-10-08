import { db, pool, notificationOutboxTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { readSmtpSettings, createSmtpTransport, smtpErrorMessage } from "./notification-config";
import { logger } from "./logger";
import { createHash } from "node:crypto";

type DeliveryContext = {
  email: string; name: string; projectName: string; projectId: number;
  cardTitle: string | null; boardId: number | null; dueDate: Date | null;
};
type Job = typeof notificationOutboxTable.$inferSelect;

export async function scanDueNotifications() {
  await db.execute(sql`
    INSERT INTO notification_outbox (dedupe_key, user_id, project_id, card_id, kind, due_date)
    SELECT 'due:' || c.id || ':' || m.user_id || ':' || extract(epoch FROM c.due_date),
      m.user_id, p.id, c.id, 'cardDue', c.due_date
    FROM board_cards c
    JOIN board_card_members m ON m.card_id = c.id
    JOIN notification_preferences n ON n.user_id = m.user_id AND n.card_due = true
    JOIN board_columns col ON col.id = c.column_id
    JOIN boards b ON b.id = col.board_id AND b.archived_at IS NULL
    JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
    WHERE c.completed_at IS NULL AND c.due_date > now()
      AND c.due_date <= now() + n.due_soon_hours * interval '1 hour'
    ON CONFLICT (dedupe_key) DO NOTHING
  `);
}

export async function deliveryContext(job: Job): Promise<DeliveryContext | null> {
  // Re-check preferences, project permissions and assignment at delivery time.
  const preference = job.kind === "cardAssigned" ? "card_assigned" : job.kind === "projectAdded" ? "project_added" : "card_due";
  if (!["cardAssigned", "projectAdded", "cardDue"].includes(job.kind)) return null;
  const result = await db.execute<DeliveryContext>(sql`
    SELECT u.email, u.name, p.name AS "projectName", p.id AS "projectId",
      c.title AS "cardTitle", b.id AS "boardId", c.due_date AS "dueDate"
    FROM users u
    JOIN notification_preferences n ON n.user_id = u.id AND ${sql.raw(`n.${preference}`)} = true
    JOIN projects p ON p.id = ${job.projectId} AND p.archived_at IS NULL
    LEFT JOIN board_cards c ON c.id = ${job.cardId}
    LEFT JOIN board_columns col ON col.id = c.column_id
    LEFT JOIN boards b ON b.id = col.board_id
    WHERE u.id = ${job.userId}
      AND (u.role = 'admin' OR NOT EXISTS (
        SELECT 1 FROM site_settings WHERE key = 'projects_enabled' AND value = 'false'
      ))
      AND (u.role = 'admin' OR p.created_by_id = u.id OR p.manager_id = u.id OR EXISTS (
        SELECT 1 FROM project_groups pg JOIN group_members gm ON gm.group_id = pg.group_id
        WHERE pg.project_id = p.id AND gm.user_id = u.id
      ))
      AND (${job.kind} = 'projectAdded' OR (
        b.project_id = p.id AND b.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM board_card_members m WHERE m.card_id = c.id AND m.user_id = u.id)
        AND (${job.kind} <> 'cardDue' OR (
          c.completed_at IS NULL AND c.due_date = ${job.dueDate} AND c.due_date > now()
          AND c.due_date <= now() + n.due_soon_hours * interval '1 hour'
        ))
      ))
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export function notificationMessage(job: Job, context: DeliveryContext, appUrl: string) {
  const project = `PROJ-${context.projectId}: ${context.projectName}`;
  const link = `${appUrl}/projects/${context.projectId}${context.boardId && job.kind !== "projectAdded" ? `/boards/${context.boardId}` : ""}`;
  const event = job.kind === "projectAdded" ? `You've been added to project ${project}.`
    : job.kind === "cardAssigned" ? `You've been assigned the card "${context.cardTitle}" in ${project}.`
    : `Your card "${context.cardTitle}" in ${project} is due on ${new Date(context.dueDate!).toISOString()} (UTC).`;
  return {
    subject: job.kind === "projectAdded" ? `Added to PROJ-${context.projectId}`
      : job.kind === "cardAssigned" ? `Card assigned: ${context.cardTitle}` : `Card due soon: ${context.cardTitle}`,
    text: `Hi ${context.name},\n\n${event}\n\nOpen in the app:\n${link}\n\nManage your notification preferences:\n${appUrl}/settings`,
  };
}

let running = false;
export async function runNotificationTick() {
  if (running) return;
  running = true;
  const client = await pool.connect().catch(error => { running = false; throw error; });
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(719045, 1) AS locked");
    locked = Boolean(lock.rows[0]?.locked);
    if (!locked) return;
    const config = await readSmtpSettings();
    if (!config.enabled) return;
    await scanDueNotifications();
    const result = await db.execute<Job>(sql`
      SELECT id, dedupe_key AS "dedupeKey", user_id AS "userId", project_id AS "projectId",
        card_id AS "cardId", kind, due_date AS "dueDate", status, attempts,
        available_at AS "availableAt", created_at AS "createdAt", sent_at AS "sentAt", last_error AS "lastError"
      FROM notification_outbox WHERE status = 'pending' AND available_at <= now()
      ORDER BY id LIMIT 20
    `);
    for (const job of result.rows) {
      const context = Date.now() - new Date(job.createdAt).getTime() < 7 * 86400000 ? await deliveryContext(job) : null;
      if (!context) {
        await db.update(notificationOutboxTable).set({ status: "skipped" }).where(eq(notificationOutboxTable.id, job.id));
        continue;
      }
      let transport: ReturnType<typeof createSmtpTransport> | undefined;
      try {
        transport = createSmtpTransport(config);
        const result = await transport.sendMail({
          from: { name: config.fromName, address: config.fromEmail }, to: context.email,
          // Stable message-id helps mail servers recognize retries after a crash.
          messageId: `<${createHash("sha256").update(job.dedupeKey).digest("hex")}@${createMessageIdDomain(config.fromEmail)}>`,
          ...notificationMessage(job, context, config.appUrl),
        });
        if (!result.accepted?.length) throw new Error("Recipient was not accepted");
        await db.update(notificationOutboxTable).set({ status: "sent", sentAt: new Date(), attempts: job.attempts + 1, lastError: null })
          .where(eq(notificationOutboxTable.id, job.id));
      } catch (error) {
        const attempts = job.attempts + 1;
        const message = smtpErrorMessage(error);
        logger.warn({ notificationId: job.id, attempts, reason: message }, "Notification delivery failed");
        await db.update(notificationOutboxTable).set({
          attempts, status: attempts >= 5 ? "failed" : "pending", lastError: message,
          availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000),
        }).where(eq(notificationOutboxTable.id, job.id));
      } finally { transport?.close(); }
    }
    // Retain recent delivery history; avoid an unbounded outbox.
    await db.execute(sql`DELETE FROM notification_outbox WHERE status <> 'pending' AND created_at < now() - interval '30 days'`);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(719045, 1)");
    client.release();
    running = false;
  }
}
function createMessageIdDomain(email: string) {
  return `notifications.${email.split("@")[1] ?? "localhost"}`;
}
export function startNotificationWorker() {
  const tick = () => runNotificationTick().catch(() => logger.error("Notification worker failed; retrying on the next scheduled check."));
  void tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
}
