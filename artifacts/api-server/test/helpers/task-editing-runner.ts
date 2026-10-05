import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";

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
  lists = await request("/tasks/lists");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === task.id).title, "Updated task");
  const completed = await request(`/tasks/${task.id}`, "PATCH", { completed: true });
  const editedCompleted = await request(`/tasks/${task.id}`, "PATCH", { title: "Edited completed task" });
  assert.equal(editedCompleted.completedAt, completed.completedAt);
  assert.equal(editedCompleted.position, task.position);
  assert.equal(editedCompleted.listId, list.id);
  lists = await request("/tasks/lists");
  assert.equal(lists.lists[0].tasks.find((row: any) => row.id === task.id).title, "Edited completed task");
  assert.equal((await request(`/tasks/${task.id}`, "PATCH", { completed: false })).completedAt, null);
  console.log("Active/completed task editing, saved titles, blank/type validation, preserved status/order and personal ownership passed.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}