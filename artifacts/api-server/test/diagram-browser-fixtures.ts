import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import bcrypt from "bcryptjs";
import { db, pool, usersTable, articlesTable, articleImagesTable } from "@workspace/db";
import { inArray, or, sql } from "drizzle-orm";

// Browser tests use ONLY these disposable accounts/articles. No settings,
// existing accounts or application content are changed.
const file = "/tmp/lexikon-diagram-browser.json";
try {
  if (process.argv.includes("--cleanup")) {
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    const ids = fixture.users.map((u: { id: number }) => u.id);
    const articles = await db.select({ id: articlesTable.id }).from(articlesTable)
      .where(inArray(articlesTable.createdById, ids));
    await db.delete(articleImagesTable).where(or(
      inArray(articleImagesTable.uploadedById, ids),
      ...(articles.length ? [inArray(articleImagesTable.articleId, articles.map(a => a.id))] : []),
    ));
    await db.delete(articlesTable).where(inArray(articlesTable.createdById, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await db.execute(sql`DELETE FROM user_sessions WHERE ${inArray(sql`(sess->>'userId')::integer`, ids)}`);
    unlinkSync(file);
    console.log("Disposable diagram fixtures cleaned.");
  } else {
    const prefix = `diagram-browser-${randomUUID().slice(0, 8)}`;
    const users = [];
    for (const role of ["admin", "editor", "user"] as const) {
      const password = randomUUID();
      const [user] = await db.insert(usersTable).values({
        email: `${prefix}-${role}@example.test`, name: prefix, role,
        passwordHash: await bcrypt.hash(password, 10),
      }).returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });
      users.push({ ...user, password });
    }
    writeFileSync(file, JSON.stringify({ prefix, users }), { mode: 0o600 });
    console.log("Disposable diagram credentials prepared in /tmp/lexikon-diagram-browser.json");
  }
} finally { await pool.end(); }
