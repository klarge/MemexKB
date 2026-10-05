import { pgTable, serial, text, integer, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const policySubjectsTable = pgTable("policy_subjects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id").references((): AnyPgColumn => policySubjectsTable.id, { onDelete: "restrict" }),
});
export const insertPolicySubjectSchema = createInsertSchema(policySubjectsTable).omit({ id: true });
export type PolicySubject = typeof policySubjectsTable.$inferSelect;