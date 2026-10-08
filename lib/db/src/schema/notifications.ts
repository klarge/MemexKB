import { pgTable, integer, boolean, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable, boardCardsTable } from "./projects";

export const notificationPreferencesTable = pgTable("notification_preferences", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  cardAssigned: boolean("card_assigned").notNull().default(false),
  projectAdded: boolean("project_added").notNull().default(false),
  cardDue: boolean("card_due").notNull().default(false),
  dueSoonHours: integer("due_soon_hours").notNull().default(24),
});

export const notificationOutboxTable = pgTable("notification_outbox", {
  id: serial("id").primaryKey(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  cardId: integer("card_id").references(() => boardCardsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
}, table => [index("notification_outbox_pending_idx").on(table.status, table.availableAt)]);
