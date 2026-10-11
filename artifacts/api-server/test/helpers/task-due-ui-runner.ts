import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, projectsTable, boardsTable, boardColumnsTable, boardCardsTable, boardCardMembersTable } from "@workspace/db";

// Explicitly opt-in: creates and removes only unique, synthetic UI fixtures.
assert.equal(process.env.RUN_TASK_DUE_UI_CHECK, "1");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
assert.ok(process.env.REPLIT_DEV_DOMAIN);
const prefix = `Due check ${randomUUID().slice(0, 8)}`;
const password = randomUUID();
const [person] = await db.insert(usersTable).values({
  name: prefix, email: `${randomUUID()}@example.test`, role: "editor",
  passwordHash: await bcrypt.hash(password, 10),
}).returning();
let projectId: number | undefined;
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await context.request.fetch(base + "/api" + path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.status() === 204 ? null : response.json();
  };
  await api("POST", "/auth/login", { email: person.email, password });
  const list = await api("POST", "/tasks/lists", { name: prefix });
  const title = `${prefix} task`;
  const task = await api("POST", "/tasks", { listId: list.id, title });
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const cardDate = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
  const [project] = await db.insert(projectsTable).values({ name: prefix, createdById: person.id }).returning();
  projectId = project.id;
  const [board] = await db.insert(boardsTable).values({ projectId, name: prefix }).returning();
  const [column] = await db.insert(boardColumnsTable).values({ boardId: board.id, name: "Todo" }).returning();
  const cardTitle = `${prefix} card`;
  const [card] = await db.insert(boardCardsTable).values({
    columnId: column.id, title: cardTitle, dueDate: new Date(cardDate),
  }).returning();
  await db.insert(boardCardMembersTable).values({ cardId: card.id, userId: person.id });

  await page.goto(base + "/tasks");
  const edit = () => page.getByRole("button", { name: `Edit task ${title}`, exact: true });
  const dialog = () => page.getByRole("dialog");
  await edit().click();
  await page.getByTestId("input-task-due-date").fill(dueDate);
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await page.reload();
  await edit().click();
  assert.equal(await page.getByTestId("input-task-due-date").inputValue(), dueDate);
  await page.screenshot({ path: "/tmp/task-due-edit-desktop.png" });
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  const shortDate = new Date(dueDate + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  await page.getByText(shortDate, { exact: true }).waitFor();

  const upcoming = () => page.locator("section").filter({ has: page.getByRole("heading", { name: "Upcoming Due Dates" }) });
  await page.goto(base + "/");
  await upcoming().getByText(cardTitle, { exact: true }).waitFor();
  await upcoming().getByText(title, { exact: true }).waitFor();
  const upcomingText = await upcoming().innerText();
  assert.ok(upcomingText.indexOf(title) < upcomingText.indexOf(cardTitle));
  await page.screenshot({ path: "/tmp/task-due-home-desktop.png" });
  // Client-side navigation preserves the dashboard cache for the completion check.
  await upcoming().getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await page.getByRole("button", { name: "Mark complete", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await upcoming().getByText(cardTitle, { exact: true }).waitFor();
  await upcoming().getByText(title, { exact: true }).waitFor({ state: "hidden" });

  await api("PATCH", `/tasks/${task.id}`, { completed: false });
  await page.goto(base + "/tasks");
  await edit().click();
  await page.getByTestId("button-clear-task-due-date").click();
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await page.reload();
  await edit().click();
  assert.equal(await page.getByTestId("input-task-due-date").inputValue(), "");
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await api("GET", "/dashboard")).upcomingTasks.length, 0);

  await page.goto(base + "/settings");
  await page.getByTestId("switch-taskDue").click();
  await page.getByTestId("select-due-soon-hours").selectOption("48");
  await page.getByTestId("button-save-preferences").click();
  await page.getByTestId("status-preferences-saved").waitFor();
  await page.reload();
  await page.getByTestId("switch-taskDue").waitFor();
  assert.equal(await page.getByTestId("switch-taskDue").getAttribute("data-state"), "checked");
  assert.equal(await page.getByTestId("switch-cardDue").getAttribute("data-state"), "unchecked");
  assert.equal(await page.getByTestId("select-due-soon-hours").inputValue(), "48");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/tasks");
  const collapse = page.getByRole("button", { name: `Collapse task list ${prefix}`, exact: true });
  await collapse.click();
  await page.getByRole("button", { name: `Expand task list ${prefix}`, exact: true }).click();
  assert.equal(await edit().innerText(), "");
  await edit().click();
  assert.ok(await page.getByTestId("input-task-due-date").isVisible());
  assert.ok(await dialog().getByRole("button", { name: "Save", exact: true }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: "/tmp/task-due-edit-mobile.png" });
  assert.deepEqual(errors, []);
  console.log("Task due-date browser check passed: edit/save/reload, UTC calendar date, mixed Home ordering, completion cache refresh, clear date, independent email preference, mobile layout and collapse.");
} finally {
  await browser.close();
  if (projectId !== undefined) await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  await db.delete(usersTable).where(eq(usersTable.id, person.id));
  await pool.end();
}
