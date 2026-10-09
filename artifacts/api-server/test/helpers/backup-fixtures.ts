import * as records from "@workspace/db";
import { readFileSync } from "node:fs";
import { sql as recordsSql } from "drizzle-orm";

const diagramPng = readFileSync(new URL("../fixtures/drawio-local.png", import.meta.url));
const when = new Date("2026-01-02T03:04:05.000Z");
export const sourceSteps = [
  { title: "Review policy", description: '<p>Read [[rule|Policy]].</p><img src="/api/articles/images/51" alt="Step illustration" />' },
  { title: "Finish independently", description: "<p>Complete the second step in any order.</p>" },
];

export async function seedBackupFixtures() {
  const { db } = records;
  await db.insert(records.usersTable).values([
    { id: 1, name: "Fixture administrator", email: "admin@example.test", role: "admin", passwordHash: "fixture-only" },
    { id: 2, name: "Fixture owner", email: "owner@example.test", role: "editor", passwordHash: "fixture-only" },
    { id: 3, name: "Fixture member", email: "member@example.test", role: "user", passwordHash: "fixture-only" },
    { id: 4, name: "Fixture outsider", email: "outsider@example.test", role: "user", passwordHash: "fixture-only" },
  ].map((u) => ({ ...u, createdAt: when, updatedAt: when })) as any);
  await db.insert(records.groupsTable).values({ id: 7, name: "Fixture team", description: "Shared access", createdAt: when });
  await db.insert(records.groupMembersTable).values([{ groupId: 7, userId: 2 }, { groupId: 7, userId: 3 }]);
  await db.insert(records.policySubjectsTable).values([
    { id: 7, name: "Operations", parentId: null },
    { id: 8, name: "Safety", parentId: 7 },
    { id: 9, name: "Unused category", parentId: 7 },
  ]);
  await db.insert(records.projectsTable).values([
    { id: 5, name: "Private snapshot", description: "Created from [[deleted-procedure|Deleted procedure]]", createdById: 2 },
    { id: 6, name: "Shared snapshot", description: "Created from [[procedure|Procedure]]", createdById: 2 },
  ]);
  await db.insert(records.projectGroupsTable).values({ projectId: 6, groupId: 7 });
  await db.insert(records.articlesTable).values([
    { id: 11, slug: "rule", title: "Safety rule", kind: "policy", policySubjectId: 8, visibility: "group", isStatic: true, content: "<p>Follow this policy.</p>" },
    { id: 12, slug: "procedure", title: "Ordered procedure", kind: "procedure", visibility: "personal", content: "<p>Introduction only.</p>", procedureSteps: sourceSteps },
    { id: 13, slug: "knowledge", title: "Knowledge reference", visibility: "public", content: '<p>[[procedure|Procedure]]</p><img src="/api/articles/images/52" alt="Introduction illustration" data-diagram="drawio" width="480" data-caption="Local diagram" />' },
    { id: 15, slug: "log-owner-daily", logSlug: "daily", title: "Daily log", isLogEntry: true, content: "<p>Private log.</p>" },
    { id: 16, slug: "project-document", title: "Project document", projectId: 5, content: "<p>Private project document.</p>" },
  ].map((a) => ({ ...a, createdById: 2, updatedById: 2, createdAt: when, updatedAt: when })) as any);
  await db.insert(records.articleGroupsTable).values({ articleId: 11, groupId: 7 });
  await db.insert(records.articleLinksTable).values([
    { fromArticleId: 12, toSlug: "rule" }, { fromArticleId: 13, toSlug: "procedure" },
  ]);
  await db.insert(records.articleImagesTable).values([
    { id: 51, articleId: 12, filename: "step.png", mimeType: "image/png", data: Buffer.from("step-image-bytes").toString("base64") },
    { id: 52, articleId: 13, filename: "intro.png", mimeType: "image/png", data: diagramPng.toString("base64") },
  ].map((i) => ({ ...i, uploadedById: 2, createdAt: when })));
  await db.insert(records.articleVersionsTable).values([
    { id: 19, articleId: 12, versionNumber: 1, title: "Before structured steps", content: "<p>Older Knowledge version.</p>", procedureSteps: [], createdById: 2 },
    { id: 21, articleId: 12, versionNumber: 2, title: "Original procedure", content: "<p>Original introduction.</p>", procedureSteps: sourceSteps, createdById: 2 },
    { id: 20, articleId: 11, versionNumber: 1, title: "Original policy", content: "<p>Original policy.</p>", policySubjectId: 8, createdById: 2 },
  ]);
  await db.insert(records.tagsTable).values({ id: 5, name: "Fixture tag", color: "#345678" });
  await db.insert(records.articleTagsTable).values([{ articleId: 11, tagId: 5 }, { articleId: 12, tagId: 5 }]);
  await db.insert(records.templatesTable).values([
    { id: 10, name: "Policy template", kind: "policy", content: "<h2>Policy</h2>" },
    { id: 11, name: "Procedure template", kind: "procedure", content: "<h2>Purpose</h2>", procedureSteps: [{ title: "Template step", description: "Template instructions" }] },
    { id: 12, name: "Knowledge template", kind: "knowledge", content: "<h2>Overview</h2>" },
  ].map((t) => ({ ...t, createdById: 1 })) as any);
  await db.insert(records.templateTagsTable).values({ templateId: 11, tagId: 5 });
  await db.insert(records.boardsTable).values([{ id: 5, projectId: 5, name: "Private procedure" }, { id: 6, projectId: 6, name: "Shared procedure" }]);
  await db.insert(records.boardColumnsTable).values([
    { id: 7, boardId: 5, name: "To Do", position: 0 },
    { id: 8, boardId: 5, name: "In Progress", position: 1 },
    { id: 9, boardId: 5, name: "Done", position: 2 },
    { id: 10, boardId: 6, name: "To Do", position: 0 },
  ]);
  await db.insert(records.boardCardsTable).values([
    { id: 41, columnId: 7, title: "1. Review", description: "Copied original description", createdById: 2, position: 0 },
    { id: 42, columnId: 9, title: "2. Finish", description: "Completed before step one", createdById: 2, completedAt: when, position: 0 },
    { id: 43, columnId: 10, title: "1. Shared review", description: "Independent shared snapshot", createdById: 2, position: 0 },
  ]);
  await db.insert(records.boardCardMembersTable).values({ cardId: 42, userId: 2 });
  await db.insert(records.boardCardCommentsTable).values({ id: 2, cardId: 42, userId: 2, content: "Done independently" });
  await db.insert(records.procedureRunsTable).values([
    { key: "2:private-confirmation", sourceSlug: "deleted-procedure", projectId: 5, boardId: 5 },
    { key: "2:shared-confirmation", sourceSlug: "procedure", projectId: 6, boardId: 6 },
  ]);
  await db.insert(records.taskListsTable).values({ id: 1, name: "Fixture tasks", userId: 2 });
  await db.insert(records.tasksTable).values({ id: 1, listId: 1, title: "Fixture task" });
  await db.insert(records.ssoConfigsTable).values({
    id: 1, name: "Fixture provider", provider: "oidc", enabled: true,
    config: { issuerUrl: "https://identity.example.test", clientSecret: "fixture-not-a-real-secret" },
  });
  await db.insert(records.siteSettingsTable).values([
    { key: "policies_enabled", value: "true" }, { key: "procedures_enabled", value: "true" },
    { key: "projects_enabled", value: "true" },
    { key: "policy_template_id", value: "10" }, { key: "procedure_template_id", value: "11" },
  ]);
  await db.execute(recordsSql`INSERT INTO user_sessions(sid, sess, expire) VALUES ('fixture-session', '{"userId":1}', NOW() + INTERVAL '1 day')`);
}
