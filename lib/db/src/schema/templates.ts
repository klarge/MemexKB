import { pgTable, serial, text, timestamp, integer, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tagsTable, type ContentKind, type ProcedureStep } from "./articles";

export const templatesTable = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  kind: text("kind").$type<ContentKind>().notNull().default("knowledge"),
  procedureSteps: jsonb("procedure_steps").$type<ProcedureStep[]>().notNull().default([]),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templateTagsTable = pgTable(
  "template_tags",
  {
    templateId: integer("template_id")
      .notNull()
      .references(() => templatesTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.tagId] })],
);

export type Template = typeof templatesTable.$inferSelect;
export type TemplateTag = typeof templateTagsTable.$inferSelect;
