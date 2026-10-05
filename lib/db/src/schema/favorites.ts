import { sql } from "drizzle-orm";
import { pgTable, serial, integer, timestamp, unique, check } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { articlesTable } from "./articles";
import { projectsTable } from "./projects";

export const favoritesTable = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  articleId: integer("article_id").references(() => articlesTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("favorites_user_article_unique").on(table.userId, table.articleId),
  unique("favorites_user_project_unique").on(table.userId, table.projectId),
  check("favorites_one_target", sql`(${table.articleId} IS NOT NULL) <> (${table.projectId} IS NOT NULL)`),
]);