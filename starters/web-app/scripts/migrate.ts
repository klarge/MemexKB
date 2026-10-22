import { pool } from "../db";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7150293)");
    const marker = await client.query("SELECT to_regclass('public.starter_migrations') AS name");
    if (!marker.rows[0].name) {
      const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      if (existing.rows.length) throw Error("Initial migration requires an empty dedicated database.");
    }
    await client.query("CREATE TABLE IF NOT EXISTS starter_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));
    for (const name of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) {
      const sql = await readFile(dir + name, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows } = await client.query("SELECT checksum FROM starter_migrations WHERE name=$1", [name]);
      if (rows.length) {
        if (rows[0].checksum !== checksum) throw Error(`Applied migration changed: ${name}`);
        continue;
      }
      // Never attach the starter to a populated donor database by accident.
      if (name === "0001_foundation.sql") {
        const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'starter_migrations'");
        if (existing.rows.length) throw Error("Initial migration requires an empty dedicated database.");
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO starter_migrations(name,checksum) VALUES ($1,$2)", [name,checksum]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(7150293)"); client.release(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await migrate(); process.stdout.write("Migrations applied.\n"); }
  finally { await pool.end(); }
}
