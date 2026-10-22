import { pgTable, text } from "drizzle-orm/pg-core";

export const siteSettingsTable = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
