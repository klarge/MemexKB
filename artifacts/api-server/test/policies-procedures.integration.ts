// Run explicitly against the development API:
// pnpm --filter @workspace/api-server exec tsx test/policies-procedures.integration.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, usersTable, articlesTable, projectsTable, policySubjectsTable, siteSettingsTable, templatesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const base = process.env.TEST_API_BASE ?? "http://localhost:80/api";
const prefix = `procedure-test-${randomUUID()}`;
const password = randomUUID();
const userIds: number[] = [], articleIds: number[] = [], projectIds: number[] = [], subjectIds: number[] = [], templateIds: number[] = [];
const originalSettings = await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, ["projects_enabled", "policy_template_id", "procedure_template_id"]));
const cookies = new Map<string, string>();

async function api(role: string, method: string, path: string, data?: unknown, expected = 200): Promise<any> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Cookie: cookies.get(role) ?? "" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (path === "/auth/login") cookies.set(role, response.headers.get("set-cookie")?.split(";")[0] ?? "");
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}
async function create(role: string, data: Record<string, unknown>) {
  const result = await api(role, "POST", "/articles", data, 201);
  articleIds.push(result.id);
  return result;
}
try {
  for (const role of ["admin", "editor", "user", "outsider"] as const) {
    const email = `${prefix}-${role}@example.test`;
    const [user] = await db.insert(usersTable).values({ email, name: prefix, role: role === "outsider" ? "editor" : role, passwordHash: await bcrypt.hash(password, 10) }).returning();
    userIds.push(user.id);
    await api(role, "POST", "/auth/login", { email, password });
  }
  await api("admin", "PATCH", "/admin/settings", { projectsEnabled: true });
  const parent = await api("admin", "POST", "/policy-subjects", { name: prefix }, 201);
  const child = await api("admin", "POST", "/policy-subjects", { name: "Child", parentId: parent.id }, 201);
  subjectIds.push(parent.id, child.id);
  await api("admin", "PATCH", `/policy-subjects/${parent.id}`, { name: prefix, parentId: child.id }, 400);
  await api("editor", "POST", "/policy-subjects", { name: "Forbidden" }, 403);
  await api("admin", "DELETE", `/policy-subjects/${parent.id}`, undefined, 409);
  const policy = await create("editor", { title: `${prefix} Policy`, kind: "policy", policySubjectId: child.id, visibility: "public", content: "<p>Standing rule</p>" });
  await api("editor", "POST", "/articles", { title: prefix, kind: "policy" }, 400);
  const procedure = await create("editor", { title: `${prefix} Procedure`, kind: "procedure", visibility: "public", content: `<p>Read [[${policy.slug}|Policy]]</p>`, procedureSteps: [{ title: "Review", description: `Read [[${policy.slug}|Policy]]` }, { title: "Finish", description: "Finish independently" }] });
  await api("editor", "POST", "/articles", { title: prefix, kind: "procedure", procedureSteps: [] }, 400);
  const privateProcedure = await create("editor", { title: `${prefix} Private`, kind: "procedure", procedureSteps: [{ title: "Secret", description: "Do not expose" }] });
  const knowledge = await create("editor", { title: `${prefix} Knowledge`, visibility: "public", content: `[[${procedure.slug}|Procedure]]` });
  const list = await api("editor", "GET", `/articles?search=${prefix}`);
  assert.ok(list.articles.some((a: any) => a.id === knowledge.id));
  assert.ok(!list.articles.some((a: any) => a.id === policy.id || a.id === procedure.id));
  const scope = await api("user", "GET", `/articles?kind=policy&subjectId=${parent.id}&limit=1&offset=0`);
  assert.equal(scope.total, 1);
  assert.equal(scope.articles[0].id, policy.id);
  const search = await api("user", "GET", `/search?q=${prefix}`);
  assert.equal(search.articles.find((a: any) => a.id === procedure.id).kind, "procedure");
  assert.ok(!search.articles.some((a: any) => a.id === privateProcedure.id));
  await api("outsider", "GET", `/articles/${privateProcedure.slug}`, undefined, 404);
  await api("outsider", "GET", `/articles/${privateProcedure.slug}/versions`, undefined, 404);
  await api("outsider", "GET", `/articles/${privateProcedure.slug}/export/md`, undefined, 404);
  const backlinks = await api("user", "GET", `/articles/${policy.slug}/backlinks`);
  assert.equal(backlinks.find((a: any) => a.id === procedure.id).kind, "procedure");
  await api("user", "POST", `/articles/${procedure.slug}/run`, { name: prefix, requestId: randomUUID() }, 403);
  await api("editor", "POST", `/articles/${policy.slug}/run`, { name: prefix, requestId: randomUUID() }, 400);
  await api("outsider", "POST", `/articles/${privateProcedure.slug}/run`, { name: prefix, requestId: randomUUID() }, 404);
  const key = randomUUID();
  const [run, duplicate] = await Promise.all([api("editor", "POST", `/articles/${procedure.slug}/run`, { name: prefix, requestId: key }, 201), api("editor", "POST", `/articles/${procedure.slug}/run`, { name: prefix, requestId: key }, 201)]);
  projectIds.push(run.projectId);
  assert.deepEqual(run, duplicate);
  const board = await api("editor", "GET", `/boards/${run.boardId}`);
  assert.deepEqual(board.columns.map((c: any) => c.name), ["To Do", "In Progress", "Done"]);
  assert.deepEqual(board.columns[0].cards.map((c: any) => c.title), ["1. Review", "2. Finish"]);
  assert.ok(board.columns[0].cards[0].description.includes(policy.slug));
  await api("user", "GET", `/projects/${run.projectId}`, undefined, 403);
  const second = board.columns[0].cards[1];
  await api("editor", "PATCH", `/boards/${run.boardId}/cards/reorder`, { columns: [
    { columnId: board.columns[0].id, cardIds: [board.columns[0].cards[0].id] },
    { columnId: board.columns[1].id, cardIds: [] },
    { columnId: board.columns[2].id, cardIds: [second.id] },
  ] });
  const sourceVersions = await api("editor", "GET", `/articles/${procedure.slug}/versions`);
  await api("editor", "PATCH", `/articles/${procedure.slug}`, { procedureSteps: [{ title: "Revised", description: "New snapshot" }] });
  const unchanged = await api("editor", "GET", `/boards/${run.boardId}`);
  assert.equal(unchanged.columns[2].cards[0].title, "2. Finish");
  await api("editor", "POST", `/articles/${procedure.slug}/versions/${sourceVersions[0].id}/restore`);
  const restored = await api("editor", "GET", `/articles/${procedure.slug}`);
  assert.equal(restored.procedureSteps.length, 2);
  const rerun = await api("editor", "POST", `/articles/${procedure.slug}/run`, { name: prefix, requestId: randomUUID() }, 201);
  projectIds.push(rerun.projectId);
  assert.notEqual(rerun.projectId, run.projectId);
  await api("admin", "PATCH", "/admin/settings", { projectsEnabled: false });
  await api("admin", "POST", `/articles/${procedure.slug}/run`, { name: prefix, requestId: randomUUID() }, 403);
  await api("admin", "PATCH", "/admin/settings", { projectsEnabled: true });
  await api("admin", "DELETE", `/policy-subjects/${child.id}`, undefined, 409);
  const template = await api("admin", "POST", "/templates", { name: prefix, kind: "procedure", procedureSteps: [{ title: "Template step", description: "Template instruction" }] }, 201);
  templateIds.push(template.id);
  await api("admin", "PATCH", "/admin/settings", { policyTemplateId: template.id }, 400);
  await api("admin", "PATCH", "/admin/settings", { procedureTemplateId: template.id });
  await api("admin", "DELETE", `/templates/${template.id}`, undefined, 409);
  await api("admin", "PATCH", "/admin/settings", { procedureTemplateId: null });
  await api("admin", "PATCH", `/articles/${policy.slug}/slug`, { slug: `${policy.slug}-renamed` });
  const migrated = await api("editor", "GET", `/articles/${procedure.slug}`);
  assert.ok(migrated.procedureSteps[0].description.includes(`${policy.slug}-renamed`));
  await api("editor", "DELETE", `/articles/${procedure.slug}`);
  const survives = await api("editor", "GET", `/boards/${run.boardId}`);
  assert.equal(survives.columns[0].cards[0].title, "1. Review");
  console.log("Policies/procedures API integration checks passed");
} finally {
  if (articleIds.length) await db.delete(articlesTable).where(inArray(articlesTable.id, articleIds));
  if (projectIds.length) await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
  for (const id of [...subjectIds].reverse()) await db.delete(policySubjectsTable).where(eq(policySubjectsTable.id, id));
  for (const key of ["projects_enabled", "policy_template_id", "procedure_template_id"]) {
    const original = originalSettings.find((s) => s.key === key);
    if (original) await db.insert(siteSettingsTable).values(original).onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: original.value } });
    else await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
  }
  if (templateIds.length) await db.delete(templatesTable).where(inArray(templatesTable.id, templateIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (userIds.length) await db.execute(sql`DELETE FROM user_sessions WHERE ${inArray(sql`(sess->>'userId')::integer`, userIds)}`);
  await pool.end();
}