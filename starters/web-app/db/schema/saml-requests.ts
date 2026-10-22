import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { ssoConfigsTable } from "./sso";
export const samlRequestsTable = pgTable("saml_requests", {
  requestId: text("request_id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => ssoConfigsTable.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});
