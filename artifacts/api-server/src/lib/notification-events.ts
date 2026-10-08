import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Executor = Pick<typeof db, "execute">;
export type NotificationKind = "cardAssigned" | "projectAdded" | "cardDue";
const preferenceColumns = { cardAssigned: "card_assigned", projectAdded: "project_added", cardDue: "card_due" };

export async function enqueueNotification(
  kind: NotificationKind, userId: number, projectId: number, cardId: number | null = null,
  client: Executor = db,
) {
  // Disabled SMTP and opted-out users do not accumulate a historical backlog.
  await client.execute(sql`
    INSERT INTO notification_outbox (dedupe_key, user_id, project_id, card_id, kind)
    SELECT ${randomUUID()}, user_id, ${projectId}, ${cardId}, ${kind}
    FROM notification_preferences
    WHERE user_id = ${userId} AND ${sql.raw(preferenceColumns[kind])} = true
      AND EXISTS (SELECT 1 FROM site_settings WHERE key = 'notification_smtp'
        AND value::jsonb ->> 'enabled' = 'true')
    ON CONFLICT (dedupe_key) DO NOTHING
  `);
}

export async function projectAccessUserIds(projectId: number, client: Executor = db): Promise<number[]> {
  const result = await client.execute<{ id: number }>(sql`
    SELECT u.id FROM users u JOIN projects p ON p.id = ${projectId}
    WHERE p.archived_at IS NULL AND (
      u.role = 'admin' OR p.created_by_id = u.id OR p.manager_id = u.id OR EXISTS (
        SELECT 1 FROM project_groups pg JOIN group_members gm ON gm.group_id = pg.group_id
        WHERE pg.project_id = p.id AND gm.user_id = u.id
      )
    )
  `);
  return result.rows.map(row => row.id);
}

export async function accessibleProjectIds(userId: number, client: Executor = db): Promise<number[]> {
  const result = await client.execute<{ id: number }>(sql`
    SELECT p.id FROM projects p JOIN users u ON u.id = ${userId}
    WHERE p.archived_at IS NULL AND (
      u.role = 'admin' OR p.created_by_id = u.id OR p.manager_id = u.id OR EXISTS (
        SELECT 1 FROM project_groups pg JOIN group_members gm ON gm.group_id = pg.group_id
        WHERE pg.project_id = p.id AND gm.user_id = u.id
      )
    )
  `);
  return result.rows.map(row => row.id);
}

export async function enqueueNewProjectAccess(projectId: number, previousIds: number[], client: Executor = db) {
  const previous = new Set(previousIds);
  for (const userId of await projectAccessUserIds(projectId, client)) {
    if (!previous.has(userId)) await enqueueNotification("projectAdded", userId, projectId, null, client);
  }
}
