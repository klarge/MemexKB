import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import express from "express";
import { chromium, expect, type Locator, type Page } from "playwright/test";
import { sql } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";

// Fail closed before seeding or loading any route with database access.
assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const schema = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(schema.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const mutate = process.argv.includes("--mutate-filtered-reorder");
const [admin, alice, bob, emptyPerson] = await db.insert(usersTable).values([
  { name: "Board fixture admin", email: `admin-${mutate}@board.test`, role: "admin", passwordHash: "unused" },
  { name: "Alice", email: `alice-${mutate}@board.test`, role: "user", passwordHash: "unused" },
  { name: "Bob", email: `bob-${mutate}@board.test`, role: "user", passwordHash: "unused" },
  { name: "No assignments", email: `empty-${mutate}@board.test`, role: "user", passwordHash: "unused" },
]).returning();

const { default: projects } = await import("../../src/routes/projects");
const { default: auth } = await import("../../src/routes/auth");
const { default: settings } = await import("../../src/routes/settings");
const { default: favorites } = await import("../../src/routes/favorites");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  // Test-only authentication on a private, ephemeral listener. No app auth
  // settings, real accounts, sessions or production routes are modified.
  (req as any).session = { userId: admin.id, userRole: admin.role };
  (req as any).log = { error: () => undefined, warn: () => undefined };
  next();
});
app.use("/api", projects, auth, settings, favorites);
app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown fixture API route" }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
const reorderBodies: { columns: { columnId: number; cardIds: number[] }[] }[] = [];

async function json(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const project = await json("/projects", { name: `Filtered drag fixture ${mutate}` }, "POST", 201);
  const board = await json(`/projects/${project.id}/boards`, { name: "Filtered dragging" }, "POST", 201);
  const left = await json(`/boards/${board.id}/columns`, { name: "Source" }, "POST", 201);
  const right = await json(`/boards/${board.id}/columns`, { name: "Destination" }, "POST", 201);
  const emptyColumn = await json(`/boards/${board.id}/columns`, { name: "Empty" }, "POST", 201);
  const cards: Record<string, number> = {};
  async function card(columnId: number, title: string, members: number[]) {
    const created = await json(`/columns/${columnId}/cards`, { title }, "POST", 201);
    cards[title] = created.id;
    for (const userId of members) await json(`/cards/${created.id}/members`, { userId }, "POST", 201);
    return created.id as number;
  }
  const initial: Record<number, number[]> = {
    [left.id]: [
      await card(left.id, "Hidden source first", [bob.id]),
      await card(left.id, "Alice first", [alice.id]),
      await card(left.id, "Hidden source middle", [bob.id]),
      await card(left.id, "Alice second", [alice.id]),
      await card(left.id, "Hidden source last", [bob.id]),
      await card(left.id, "Shared Alice and Bob", [alice.id, bob.id]),
    ],
    [right.id]: [
      await card(right.id, "Hidden destination first", [bob.id]),
      await card(right.id, "Alice destination", [alice.id]),
      await card(right.id, "Hidden destination middle", [bob.id]),
      await card(right.id, "Unassigned card", []),
      await card(right.id, "Hidden destination last", [bob.id]),
    ],
    [emptyColumn.id]: [],
  };
  const allIds = Object.values(initial).flat().sort((a, b) => a - b);
  const executablePath = process.env.E2E_CHROMIUM_EXECUTABLE ??
    (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
  // Every API request, including startup queries, is fulfilled locally. Never
  // let a failed fixture request fall through to the real development database.
  await context.route("**/api/**", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "PATCH" && url.pathname.endsWith("/cards/reorder")) {
      reorderBodies.push(req.postDataJSON());
    }
    const response = await fetch(base + url.pathname + url.search, {
      method: req.method(),
      headers: { "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  if (mutate) {
    await context.route("**/src/pages/board.tsx*", async route => {
      const response = await route.fetch();
      const source = await response.text();
      const needle = "Object.entries(itemsRef.current).map(([key, cardIds])";
      assert.equal(source.split(needle).length, 2, "Mutation must match exactly the persisted reorder state");
      await route.fulfill({
        response, body: source.replace(needle, "Object.entries(visibleItems).map(([key, cardIds])"),
      });
      console.log("FILTERED_REORDER_MUTATION_APPLIED");
    });
  }
  const page = await context.newPage();
  const filter = page.getByRole("combobox", { name: "Filter cards by assignee" });
  const chip = (title: string) => page.getByRole("button", { name: `Open card: ${title}`, exact: true });
  const renderedCards = page.locator('[aria-roledescription="draggable card"]');
  const column = (name: string) => page.locator(".group\\/kanban-col").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
  async function renderedOrder(name: string, ids: number[]) {
    const titles = ids.map(id => Object.keys(cards).find(title => cards[title] === id)!);
    await expect.poll(() => column(name).locator('[aria-roledescription="draggable card"]').evaluateAll(
      elements => elements.map(el => el.getAttribute("aria-label")!.replace("Open card: ", "")),
    )).toEqual(titles);
  }
  async function savedOrder(expected: Record<number, number[]>) {
    const reloaded = await json(`/boards/${board.id}`);
    const actual = Object.fromEntries(reloaded.columns.map((col: any) => [
      col.id, [...col.cards].sort((a: any, b: any) => a.position - b.position).map((c: any) => c.id),
    ]));
    assert.deepEqual(actual, expected, "reload must preserve every card and column order");
    for (const col of reloaded.columns) {
      assert.deepEqual(
        [...col.cards].sort((a: any, b: any) => a.position - b.position).map((c: any) => c.position),
        expected[col.id].map((_: number, i: number) => (i + 1) * 1000),
        "persisted card positions must be complete and unique",
      );
    }
  }
  async function clearAndReload(expected: Record<number, number[]>) {
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await expect(filter).toHaveValue("all");
    await expect(renderedCards).toHaveCount(allIds.length);
    await renderedOrder("Source", expected[left.id]);
    await renderedOrder("Destination", expected[right.id]);
    await renderedOrder("Empty", expected[emptyColumn.id]);
    await page.reload();
    await expect(filter).toHaveValue("all");
    await expect(renderedCards).toHaveCount(allIds.length);
    await renderedOrder("Source", expected[left.id]);
    await renderedOrder("Destination", expected[right.id]);
    await renderedOrder("Empty", expected[emptyColumn.id]);
    await savedOrder(expected);
  }
  async function startDrag(title: string, target: Locator) {
    const from = await chip(title).boundingBox();
    const to = await target.boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
    await expect(filter).toBeDisabled(); // proves the six-pixel sensor activated
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  }
  async function dropAndCheck() {
    const count = reorderBodies.length;
    const response = page.waitForResponse(res => res.url().endsWith(`/boards/${board.id}/cards/reorder`) && res.request().method() === "PATCH");
    await page.mouse.up();
    assert.equal((await response).status(), 200);
    await expect(filter).toBeEnabled();
    assert.equal(reorderBodies.length, count + 1);
    const payload = reorderBodies.at(-1)!;
    assert.deepEqual(payload.columns.flatMap(col => col.cardIds).sort((a, b) => a - b),
      allIds, "reorder payload must contain every card exactly once");
    assert.deepEqual(payload.columns.map(col => col.columnId).sort((a, b) => a - b),
      Object.keys(initial).map(Number).sort((a, b) => a - b));
    return Object.fromEntries(payload.columns.map(col => [col.columnId, col.cardIds]));
  }
  await page.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:80"}/projects/${project.id}/boards/${board.id}`);
  await expect(renderedCards).toHaveCount(allIds.length);
  await filter.selectOption(String(alice.id));
  await expect(renderedCards).toHaveCount(4);
  await expect(chip("Shared Alice and Bob")).toBeVisible();
  await expect(chip("Hidden source first")).toHaveCount(0);
  await filter.selectOption(String(bob.id));
  await expect(renderedCards).toHaveCount(7);
  await expect(chip("Shared Alice and Bob")).toBeVisible();
  await filter.selectOption("unassigned");
  await expect(renderedCards).toHaveCount(1);
  await expect(chip("Unassigned card")).toBeVisible();
  await filter.selectOption(String(emptyPerson.id));
  await expect(renderedCards).toHaveCount(0);
  await expect(page.getByText("No cards match this assignee.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expect(renderedCards).toHaveCount(allIds.length);
  assert.equal(reorderBodies.length, 0, "filter changes must never persist a reorder");

  // Move into a nonempty column with hidden cards before and after the target.
  await filter.selectOption(String(alice.id));
  await startDrag("Alice first", chip("Alice destination"));
  await expect(column("Destination").getByRole("button", { name: "Open card: Alice first", exact: true })).toBeVisible();
  const cross = await dropAndCheck();
  assert.deepEqual(cross[left.id], initial[left.id].filter(id => id !== cards["Alice first"]));
  assert.deepEqual(cross[right.id].filter(id => id !== cards["Alice first"]), initial[right.id],
    "all destination cards retain relative order");
  assert.ok(cross[right.id].includes(cards["Alice first"]));
  await clearAndReload(cross);

  // Same-column move must use full indices, not the two rendered indices.
  await filter.selectOption(String(alice.id));
  await startDrag("Alice second", chip("Shared Alice and Bob"));
  const same = await dropAndCheck();
  const expectedLeft = [...cross[left.id]];
  expectedLeft.splice(expectedLeft.indexOf(cards["Alice second"]), 1);
  expectedLeft.push(cards["Alice second"]);
  assert.deepEqual(same[left.id], expectedLeft);
  assert.deepEqual(same[right.id], cross[right.id]);
  await clearAndReload(same);

  // Escape after a cross-column preview must restore the entire snapshot
  // and issue no PATCH.
  await filter.selectOption(String(alice.id));
  const beforeCancel = reorderBodies.length;
  await startDrag("Shared Alice and Bob", chip("Alice destination"));
  await expect(column("Destination").getByRole("button", { name: "Open card: Shared Alice and Bob", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(filter).toBeEnabled();
  await clearAndReload(same);
  assert.equal(reorderBodies.length, beforeCancel, "cancelled dragging must not save a reorder");

  // An entirely empty destination is a distinct droppable-container path.
  await filter.selectOption(String(alice.id));
  await startDrag("Alice second", column("Empty"));
  await expect(column("Empty").getByRole("button", { name: "Open card: Alice second", exact: true })).toBeVisible();
  const intoEmpty = await dropAndCheck();
  assert.deepEqual(intoEmpty[emptyColumn.id], [cards["Alice second"]]);
  assert.deepEqual(intoEmpty[left.id], same[left.id].filter(id => id !== cards["Alice second"]));
  assert.deepEqual(intoEmpty[right.id], same[right.id]);
  await clearAndReload(intoEmpty);
  console.log("FILTERED_BOARD_DRAG_PASSED: person/multiple assignees, unassigned/clear/empty, cross-column, same-column, cancel and full reload order.");
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
