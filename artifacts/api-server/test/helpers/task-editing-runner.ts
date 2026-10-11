import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool, usersTable, siteSettingsTable } from "@workspace/db";
import dashboard from "../../src/routes/dashboard";
import projects from "../../src/routes/projects";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const schema = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(schema.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const [owner, outsider] = await db.insert(usersTable).values([
  { name: "Task owner", email: "task-owner@example.test", role: "user", passwordHash: "unused" },
  { name: "Other user", email: "task-outsider@example.test", role: "admin", passwordHash: "unused" },
]).returning();
const { default: tasks } = await import("../../src/routes/tasks");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = req.headers["x-test-actor"] === "outsider" ? outsider : owner;
  (req as any).session = { userId: person.id, userRole: person.role };
  next();
});
app.use("/api", tasks);
app.use("/api", projects);
app.use("/api", dashboard);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(path: string, method = "GET", body?: unknown, actor = "owner", status = 200) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-actor": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
try {
  const list = await request("/tasks/lists", "POST", { name: "Editable tasks" }, "owner", 201);
  const task = await request("/tasks", "POST", { listId: list.id, title: "Original task" }, "owner", 201);
  const sibling = await request("/tasks", "POST", { listId: list.id, title: "Second task" }, "owner", 201);
  assert.equal(task.dueDate, null);
  const edited = await request(`/tasks/${task.id}`, "PATCH", { title: "  Updated task  " });
  assert.equal(edited.title, "Updated task");
  for (const key of ["id", "listId", "position", "completedAt", "createdAt"]) assert.equal(edited[key], task[key]);
  let lists = await request("/tasks/lists");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === task.id).title, "Updated task");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === sibling.id).title, sibling.title);
  for (const title of ["", "   ", null, 42, {}]) {
    await request(`/tasks/${task.id}`, "PATCH", { title }, "owner", 400);
  }
  await request(`/tasks/${task.id}`, "PATCH", { title: "Not yours" }, "outsider", 404);
  await request(`/tasks/${task.id}`, "PATCH", { dueDate: "2030-02-28" }, "outsider", 404);

  const dated = await request(`/tasks/${task.id}`, "PATCH", { dueDate: "2030-02-28" });
  assert.equal(dated.dueDate, "2030-02-28T00:00:00.000Z");
  for (const key of ["id", "listId", "position", "completedAt", "title"]) assert.equal(dated[key], edited[key]);
  for (const dueDate of ["", "2030-02-30", "2030-13-01", "2030-02-28T12:00:00Z", 42, {}, "not-a-date"]) {
    await request(`/tasks/${task.id}`, "PATCH", { title: "Invalid update must be atomic", dueDate }, "owner", 400);
  }
  await request(`/tasks/${task.id}`, "PATCH", { completed: "false" }, "owner", 400);
  let upcoming = await request("/dashboard");
  assert.equal(upcoming.upcomingTasks[0].id, task.id);
  assert.equal(upcoming.upcomingTasks[0].dueDate, dated.dueDate);
  assert.equal(upcoming.upcomingTasks[0].title, edited.title);
  assert.equal(upcoming.activeTasks.find((row: any) => row.id === task.id).dueDate, dated.dueDate);
  assert.equal((await request(`/tasks/${task.id}`, "PATCH", { dueDate: null })).dueDate, null);
  assert.equal((await request("/dashboard")).upcomingTasks.length, 0);
  await request(`/tasks/${task.id}`, "PATCH", { dueDate: "2030-02-28" });
  lists = await request("/tasks/lists");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === task.id).title, "Updated task");
  const completed = await request(`/tasks/${task.id}`, "PATCH", { completed: true });
  assert.equal(completed.dueDate, dated.dueDate);
  assert.equal((await request("/dashboard")).upcomingTasks.length, 0);
  const editedCompleted = await request(`/tasks/${task.id}`, "PATCH", { title: "Edited completed task" });
  assert.equal(editedCompleted.completedAt, completed.completedAt);
  assert.equal(editedCompleted.position, task.position);
  assert.equal(editedCompleted.listId, list.id);
  assert.equal(editedCompleted.dueDate, dated.dueDate);
  lists = await request("/tasks/lists");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === task.id).title, "Edited completed task");
  assert.equal((await request(`/tasks/${task.id}`, "PATCH", { completed: false })).completedAt, null);
  assert.equal((await request("/dashboard")).upcomingTasks[0].id, task.id);

  // A due task outside the ten-task active preview must still be included.
  for (let i = 0; i < 10; i++) {
    await request("/tasks", "POST", { listId: list.id, title: `Undated task ${i}` }, "owner", 201);
  }
  const beyondPreview = await request("/tasks", "POST", { listId: list.id, title: "Earliest due task" }, "owner", 201);
  await request(`/tasks/${beyondPreview.id}`, "PATCH", { dueDate: "2028-01-01" });
  upcoming = await request("/dashboard");
  assert.ok(!upcoming.activeTasks.some((row: any) => row.id === beyondPreview.id));
  assert.equal(upcoming.upcomingTasks[0].id, beyondPreview.id);

  const privateList = await request("/tasks/lists", "POST", { name: "Other person's list" }, "outsider", 201);
  const privateTask = await request("/tasks", "POST", { listId: privateList.id, title: "Private due task" }, "outsider", 201);
  await request(`/tasks/${privateTask.id}`, "PATCH", { dueDate: "2027-01-01" }, "outsider");
  assert.ok(!(await request("/dashboard")).upcomingTasks.some((row: any) => row.id === privateTask.id));
  assert.deepEqual((await request("/dashboard", "GET", undefined, "outsider")).upcomingTasks.map((row: any) => row.id), [privateTask.id]);

  await db.insert(siteSettingsTable).values({ key: "projects_enabled", value: "false" })
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: "false" } });
  assert.equal((await request("/dashboard")).upcomingTasks[0].id, beyondPreview.id);
  assert.equal((await request("/dashboard")).upcomingCards.length, 0);
  await request("/projects", "GET", undefined, "owner", 403);

  await db.insert(siteSettingsTable).values({ key: "tasks_enabled", value: "false" })
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: "false" } });
  assert.equal((await request("/dashboard")).upcomingTasks.length, 0);
  assert.equal((await request("/dashboard", "GET", undefined, "outsider")).upcomingTasks[0].id, privateTask.id);
  console.log("task editing and due-date integration checks passed");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}