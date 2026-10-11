import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import tasks from "../../src/routes/tasks";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const schema = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(schema.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const [owner, outsider] = await db.insert(usersTable).values([
  { name: "List owner", email: "list-owner@example.test", role: "user", passwordHash: "unused" },
  { name: "Other user", email: "list-outsider@example.test", role: "admin", passwordHash: "unused" },
]).returning();
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.headers["x-test-actor"] !== "anonymous") {
    const person = req.headers["x-test-actor"] === "outsider" ? outsider : owner;
    (req as any).session = { userId: person.id, userRole: person.role };
  }
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
  assert.equal(response.status, status, await response.clone().text());
  return status === 204 ? undefined : response.json();
}
try {
  const a = await request("/tasks/lists", "POST", { name: "A" }, "owner", 201);
  const b = await request("/tasks/lists", "POST", { name: "B" }, "owner", 201);
  const c = await request("/tasks/lists", "POST", { name: "C" }, "owner", 201);
  const foreign = await request("/tasks/lists", "POST", { name: "Foreign" }, "outsider", 201);
  const task = await request("/tasks", "POST", { listId: b.id, title: "Preserved task" }, "owner", 201);
  async function order(expected: number[]) {
    const response = await request("/tasks/lists");
    assert.deepEqual(response.lists.map((list: any) => list.id), expected);
    return response;
  }
  const move = (id: number, direction: string, actor = "owner", status = 204) =>
    request(`/tasks/lists/${id}/move`, "PATCH", { direction }, actor, status);
  await order([a.id, b.id, c.id]);
  await move(b.id, "up");
  await order([b.id, a.id, c.id]);
  await move(b.id, "up"); // First list stays first.
  await order([b.id, a.id, c.id]);
  await move(b.id, "down");
  await order([a.id, b.id, c.id]);
  await move(c.id, "down"); // Last list stays last.
  await order([a.id, b.id, c.id]);
  await move(c.id, "up");
  const saved = await order([a.id, c.id, b.id]);
  assert.deepEqual(saved.lists.find((list: any) => list.id === b.id).tasks, [task]);
  await move(foreign.id, "up", "owner", 404);
  await move(b.id, "down", "outsider", 404);
  await move(b.id, "up", "anonymous", 401);
  for (const invalid of ["left", "", "UP"]) await move(b.id, invalid, "owner", 400);
  await request(`/tasks/lists/${b.id}/move`, "PATCH", {}, "owner", 400);
  await request("/tasks/lists/NaN/move", "PATCH", { direction: "up" }, "owner", 400);
  await order([a.id, c.id, b.id]);
  assert.deepEqual((await request("/tasks/lists", "GET", undefined, "outsider")).lists.map((list: any) => list.id), [foreign.id]);
  const d = await request("/tasks/lists", "POST", { name: "D" }, "owner", 201);
  await order([a.id, c.id, b.id, d.id]); // New lists append after saved order.
  await request(`/tasks/lists/${c.id}`, "DELETE", undefined, "owner", 204);
  await move(b.id, "up"); // Gaps after deletion do not prevent moving.
  await order([b.id, a.id, d.id]);
  console.log("task list order integration checks passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
