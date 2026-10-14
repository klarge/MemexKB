import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { ssoConfigsTable } from "./sso";

// Ephemeral PKCE transactions, not sessions. Only hashes of bearer codes persist.
export const mobileSsoTable = pgTable("mobile_sso", {
  ticketHash: text("ticket_hash").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => ssoConfigsTable.id, { onDelete: "cascade" }),
  challenge: text("challenge").notNull(),
  state: text("state").notNull(),
  started: boolean("started").notNull().default(false),
  samlRequestId: text("saml_request_id"),
  samlRequestInstant: text("saml_request_instant"),
  codeHash: text("code_hash").unique(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export type MobileSso = typeof mobileSsoTable.$inferSelect;
