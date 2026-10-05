import { db, pool, usersTable, articlesTable, projectsTable, templatesTable, policySubjectsTable, siteSettingsTable } from "@workspace/db";
import { eq, inArray, like, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const file = "/tmp/memex-policies-browser.json";
const keys = ["policies_enabled", "procedures_enabled", "projects_enabled", "policy_template_id", "procedure_template_id"];
try {
  if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    const ids = fixture.users.map((u: any) => u.id);
    await db.delete(articlesTable).where(inArray(articlesTable.createdById, ids));
    await db.delete(projectsTable).where(inArray(projectsTable.createdById, ids));
    for (const key of keys) {
      const original = fixture.settings.find((s: any) => s.key === key);
      if (original) await db.insert(siteSettingsTable).values(original).onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: original.value } });
      else await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
    }
    await db.delete(templatesTable).where(like(templatesTable.name, `${fixture.prefix}%`));
    const subjects = await db.select().from(policySubjectsTable).where(like(policySubjectsTable.name, `${fixture.prefix}%`));
    while (subjects.length) {
      const leaf = subjects.find((s) => !subjects.some((other) => other.parentId === s.id));
      if (!leaf) throw new Error("Unexpected test category cycle");
      await db.delete(policySubjectsTable).where(eq(policySubjectsTable.id, leaf.id));
      subjects.splice(subjects.indexOf(leaf), 1);
    }
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await db.execute(sql`DELETE FROM user_sessions WHERE ${inArray(sql`(sess->>'userId')::integer`, ids)}`);
    unlinkSync(file);
    console.log("Browser test fixtures cleaned; original settings restored");
  } else {
    const prefix = `browser-policy-${randomUUID().slice(0, 8)}`;
    const password = randomUUID();
    const users = [];
    const settings = await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, keys));
    for (const role of ["admin", "editor", "user"] as const) {
      const [user] = await db.insert(usersTable).values({ email: `${prefix}-${role}@example.test`, name: prefix, role, passwordHash: await bcrypt.hash(password, 10) }).returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });
      users.push({ ...user, password });
    }
    const [subject] = await db.insert(policySubjectsTable).values({ name: `${prefix} Category` }).returning();
    writeFileSync(file, JSON.stringify({ prefix, users, settings, subject }, null, 2));
    console.log("Temporary test fixture details prepared in /tmp/memex-policies-browser.json");
  }
} finally { await pool.end(); }