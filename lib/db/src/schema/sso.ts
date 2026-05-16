import { pgTable, serial, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const ssoConfigsTable = pgTable("sso_configs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(), // "saml" | "oidc"
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SsoConfig = typeof ssoConfigsTable.$inferSelect;
