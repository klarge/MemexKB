import { pgTable, serial, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { groupsTable } from "./groups";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  updatedById: integer("updated_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articleGroupsTable = pgTable(
  "article_groups",
  {
    articleId: integer("article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.groupId] })],
);

export const articleLinksTable = pgTable(
  "article_links",
  {
    fromArticleId: integer("from_article_id")
      .notNull()
      .references(() => articlesTable.id, { onDelete: "cascade" }),
    toSlug: text("to_slug").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromArticleId, t.toSlug] })],
);

export const articleImagesTable = pgTable("article_images", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id").references(() => articlesTable.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const articleVersionsTable = pgTable("article_versions", {
  id: serial("id").primaryKey(),
  articleId: integer("article_id")
    .notNull()
    .references(() => articlesTable.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ArticleVersion = typeof articleVersionsTable.$inferSelect;

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
export type ArticleGroup = typeof articleGroupsTable.$inferSelect;
export type ArticleLink = typeof articleLinksTable.$inferSelect;
export type ArticleImage = typeof articleImagesTable.$inferSelect;
