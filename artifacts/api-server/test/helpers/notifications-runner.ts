import assert from "node:assert/strict";
import express from "express";
import nodemailer from "nodemailer";
import { db, pool, usersTable, projectsTable, groupsTable, groupMembersTable, boardsTable, boardColumnsTable, boardCardsTable, notificationOutboxTable, siteSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import notifications from "../../src/routes/notifications";
import projects from "../../src/routes/projects";
import groups from "../../src/routes/groups";
import { runNotificationTick, scanDueNotifications, deliveryContext } from "../../src/lib/notification-worker";
import { decryptSmtpPassword, readSmtpSettings, createSmtpTransport, smtpInputSchema } from "../../src/lib/notification-config";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(actual.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
// No real SMTP connection is made, and this database has no live users/data.
const sent: { to: string; subject: string; text: string; messageId?: string }[] = [];
const options: any[] = [];
let fail = false;
nodemailer.createTransport = ((config: any) => {
  options.push(config);
  return {
    sendMail: async (mail: any) => {
      if (fail) throw Object.assign(new Error("Never disclose SMTP credentials"), { code: "EAUTH" });
      sent.push(mail);
      return { accepted: [mail.to], rejected: [] };
    },
    close: () => {},
  };
}) as typeof nodemailer.createTransport;

const people = await db.insert(usersTable).values([
  { email: "admin@example.test", name: "Admin", role: "admin", passwordHash: "unused" },
  { email: "creator@example.test", name: "Creator", role: "editor", passwordHash: "unused" },
  { email: "recipient@example.test", name: "Recipient", role: "user", passwordHash: "unused" },
  { email: "later@example.test", name: "Later member", role: "user", passwordHash: "unused" },
]).returning();
const [admin, creator, recipient, later] = people;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = people.find(person => person.id === Number(req.headers["x-test-actor"]));
  (req as any).session = person ? { userId: person.id, userRole: person.role } : {};
  next();
});
app.use("/api", notifications, projects, groups);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(actor: number, method: string, path: string, body?: unknown) {
  return fetch(base + path, { method, headers: { "x-test-actor": String(actor), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function ok(actor: number, method: string, path: string, body?: unknown) {
  const response = await request(actor, method, path, body);
  assert.ok(response.ok, `Unexpected status ${response.status} for ${method} ${path}`);
  return response.status === 204 ? null : response.json();
}
try {
  assert.equal((await request(recipient.id, "GET", "/admin/notifications")).status, 403);
  const initial = await ok(recipient.id, "GET", "/me/notifications");
  assert.equal(initial.cardAssigned, false);
  assert.equal(initial.cardDue, false);
  assert.equal(initial.projectAdded, false);
  assert.equal(initial.emailAvailable, false);
  const input = { enabled: true, host: "smtp.example.test", port: 587, security: "starttls", username: "smtp-user", password: "not-a-real-password", fromEmail: "sender@example.test", fromName: "Memex", appUrl: "https://app.example.test" };
  assert.equal((await request(recipient.id, "PUT", "/admin/notifications", input)).status, 403);
  const settings = await ok(admin.id, "PUT", "/admin/notifications", input);
  assert.equal(settings.hasPassword, true);
  assert.ok(!("password" in settings) && !("encryptedPassword" in settings));
  const stored = await readSmtpSettings();
  assert.notEqual(stored.encryptedPassword, input.password);
  assert.equal(decryptSmtpPassword(stored.encryptedPassword!), input.password);
  await ok(admin.id, "PUT", "/admin/notifications", { ...input, password: "" });
  assert.equal((await readSmtpSettings()).encryptedPassword, stored.encryptedPassword);
  await ok(admin.id, "PUT", "/admin/notifications", { ...input, password: "", clearPassword: true });
  assert.equal((await ok(admin.id, "GET", "/admin/notifications")).hasPassword, false);
  await ok(admin.id, "PUT", "/admin/notifications", input);
  assert.equal(smtpInputSchema.safeParse({ ...input, appUrl: "javascript:alert(1)" }).success, false);
  createSmtpTransport(await readSmtpSettings());
  assert.equal(options.at(-1).secure, false);
  assert.equal(options.at(-1).requireTLS, true);
  createSmtpTransport({ ...stored, security: "tls", port: 465 });
  assert.equal(options.at(-1).secure, true);

  const prefs = { cardAssigned: true, projectAdded: true, cardDue: true, dueSoonHours: 24 };
  await ok(recipient.id, "PUT", "/me/notifications", { ...prefs, userId: creator.id });
  assert.equal((await ok(creator.id, "GET", "/me/notifications")).cardAssigned, false);
  assert.equal((await ok(recipient.id, "GET", "/me/notifications")).dueSoonHours, 24);
  assert.equal((await request(recipient.id, "PUT", "/me/notifications", { ...prefs, dueSoonHours: 0 })).status, 400);

  const project = await ok(creator.id, "POST", "/projects", { name: "Notification project" });
  const [group] = await db.insert(groupsTable).values({ name: "Notification group", description: "" }).returning();
  await db.insert(groupMembersTable).values({ groupId: group.id, userId: recipient.id });
  await ok(creator.id, "POST", `/projects/${project.id}/groups`, { groupId: group.id });
  await ok(creator.id, "POST", `/projects/${project.id}/groups`, { groupId: group.id });
  let jobs = await db.select().from(notificationOutboxTable);
  assert.equal(jobs.filter(job => job.kind === "projectAdded").length, 1);
  const [board] = await db.insert(boardsTable).values({ projectId: project.id, name: "Board" }).returning();
  const [column] = await db.insert(boardColumnsTable).values({ boardId: board.id, name: "Todo" }).returning();
  const [card] = await db.insert(boardCardsTable).values({ columnId: column.id, title: "Upcoming card", dueDate: new Date(Date.now() + 2 * 3600000) }).returning();
  await ok(creator.id, "POST", `/cards/${card.id}/members`, { userId: recipient.id });
  await ok(creator.id, "POST", `/cards/${card.id}/members`, { userId: recipient.id });
  jobs = await db.select().from(notificationOutboxTable);
  assert.equal(jobs.filter(job => job.kind === "cardAssigned").length, 1);
  await ok(recipient.id, "PUT", "/me/notifications", { ...prefs, dueSoonHours: 1 });
  await scanDueNotifications();
  assert.equal((await db.select().from(notificationOutboxTable)).filter(job => job.kind === "cardDue").length, 0);
  await ok(recipient.id, "PUT", "/me/notifications", prefs);
  await scanDueNotifications();
  await scanDueNotifications();
  jobs = await db.select().from(notificationOutboxTable);
  assert.equal(jobs.filter(job => job.kind === "cardDue").length, 1);
  await runNotificationTick();
  assert.equal(sent.length, 3);
  assert.ok(sent.every(mail => mail.to === recipient.email));
  assert.ok(sent.some(mail => mail.text.includes(`/projects/${project.id}/boards/${board.id}`)));
  assert.ok(sent.every(mail => mail.text.includes(`/settings`)));
  assert.equal(new Set(sent.map(mail => mail.messageId)).size, 3);
  await runNotificationTick();
  assert.equal(sent.length, 3);

  // Due-date edits create a fresh reminder, but completed/overdue/unassigned
  // cards and opted-out users must not receive due mail.
  await db.update(boardCardsTable).set({ dueDate: new Date(Date.now() + 3 * 3600000) }).where(eq(boardCardsTable.id, card.id));
  await scanDueNotifications();
  jobs = await db.select().from(notificationOutboxTable);
  const pendingDue = jobs.find(job => job.kind === "cardDue" && job.status === "pending")!;
  assert.ok(pendingDue);
  await db.update(boardCardsTable).set({ completedAt: new Date() }).where(eq(boardCardsTable.id, card.id));
  assert.equal(await deliveryContext(pendingDue), null);
  await runNotificationTick();
  assert.equal(sent.length, 3);
  await db.update(boardCardsTable).set({ completedAt: null, dueDate: new Date(Date.now() - 1000) }).where(eq(boardCardsTable.id, card.id));
  await scanDueNotifications();
  assert.equal((await db.select().from(notificationOutboxTable)).filter(job => job.kind === "cardDue").length, 2);

  // New group members get project-added mail, not repeated on duplicate adds.
  await ok(later.id, "PUT", "/me/notifications", prefs);
  await ok(admin.id, "POST", `/groups/${group.id}/members`, { userId: later.id });
  await ok(admin.id, "POST", `/groups/${group.id}/members`, { userId: later.id });
  jobs = await db.select().from(notificationOutboxTable);
  assert.equal(jobs.filter(job => job.kind === "projectAdded" && job.userId === later.id).length, 1);
  await runNotificationTick();
  assert.equal(sent.length, 4);
  await ok(creator.id, "DELETE", `/cards/${card.id}/members/${recipient.id}`);
  await ok(creator.id, "POST", `/cards/${card.id}/members`, { userId: recipient.id });
  // Removing project access before queued delivery must not leak details.
  await ok(creator.id, "DELETE", `/projects/${project.id}/groups/${group.id}`);
  await runNotificationTick();
  assert.equal(sent.length, 4);
  await ok(creator.id, "POST", `/projects/${project.id}/groups`, { groupId: group.id });
  await ok(recipient.id, "PUT", "/me/notifications", { ...prefs, cardAssigned: false, projectAdded: false, cardDue: false });
  await runNotificationTick();
  assert.equal(sent.length, 5); // only the later member still opted in

  // A new Project Manager receives an addition event; failed SMTP delivery
  // stays in the durable queue and succeeds on a subsequent scheduled retry.
  const managed = await ok(creator.id, "POST", "/projects", { name: "Managed project" });
  await ok(creator.id, "PATCH", `/projects/${managed.id}`, { managerId: later.id });
  fail = true;
  await runNotificationTick();
  const [retry] = await db.select().from(notificationOutboxTable).where(eq(notificationOutboxTable.projectId, managed.id));
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 1);
  assert.ok(retry.availableAt.getTime() > Date.now());
  assert.equal(retry.lastError, "SMTP authentication failed. Check the username and password.");
  fail = false;
  await db.update(notificationOutboxTable).set({ availableAt: new Date() }).where(eq(notificationOutboxTable.id, retry.id));
  await runNotificationTick();
  assert.equal(sent.length, 6);
  assert.equal(sent.at(-1)!.to, later.email);

  await ok(admin.id, "POST", "/admin/notifications/test", { to: recipient.email });
  assert.equal(sent.at(-1)!.to, admin.email);
  fail = true;
  const failedTest = await request(admin.id, "POST", "/admin/notifications/test");
  assert.equal(failedTest.status, 502);
  assert.equal((await failedTest.json()).error, "SMTP authentication failed. Check the username and password.");
  fail = false;
  await ok(admin.id, "PUT", "/admin/notifications", { ...input, enabled: false });
  const countBeforeDisabled = (await db.select().from(notificationOutboxTable)).length;
  await ok(creator.id, "POST", `/cards/${card.id}/members`, { userId: later.id });
  assert.equal((await db.select().from(notificationOutboxTable)).length, countBeforeDisabled);
  console.log("notification integration checks passed");
} finally {
  server.close();
  await pool.end();
}
