import { randomUUID } from "node:crypto";

/**
 * Clone table definitions, never data. All FKs and serial defaults are rewired
 * into a private schema before a child process may run destructive restore.
 */
export async function withIsolatedBackupSchema(run: (schema: string, databaseUrl: string) => Promise<void>) {
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  const schema = `backup_test_${randomUUID().replaceAll("-", "")}`;
  const ident = (name: string) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unsafe test SQL identifier");
    return `"${name}"`;
  };
  try {
    await client.query(`CREATE SCHEMA ${ident(schema)}`);
    await client.query(`SET search_path TO ${ident(schema)}`);
    const { rows: tables } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    if (!tables.some((t) => t.tablename === "policy_subjects")) throw new Error("Initialize the application schema before running backup tests");
    for (const { tablename } of tables) {
      await client.query(`CREATE TABLE ${ident(schema)}.${ident(tablename)} (LIKE public.${ident(tablename)} INCLUDING ALL)`);
      const { rows: serials } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval(%'`, [tablename],
      );
      for (const { column_name } of serials) {
        const sequence = `${tablename}_${column_name}_seq`;
        await client.query(`CREATE SEQUENCE ${ident(schema)}.${ident(sequence)}`);
        await client.query(`ALTER TABLE ${ident(schema)}.${ident(tablename)} ALTER COLUMN ${ident(column_name)}
          SET DEFAULT nextval('${schema}.${sequence}'::regclass)`);
        await client.query(`ALTER SEQUENCE ${ident(schema)}.${ident(sequence)}
          OWNED BY ${ident(schema)}.${ident(tablename)}.${ident(column_name)}`);
      }
    }
    const { rows: foreignKeys } = await client.query<{ table_name: string; name: string; definition: string }>(
      `SELECT t.relname AS table_name, c.conname AS name, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND c.contype = 'f'`,
    );
    for (const fk of foreignKeys) {
      const definition = fk.definition.replaceAll('"public".', `${ident(schema)}.`).replace(/\bpublic\./g, `${ident(schema)}.`);
      await client.query(`ALTER TABLE ${ident(schema)}.${ident(fk.table_name)} ADD CONSTRAINT ${ident(fk.name)} ${definition}`);
    }
    const { rows: unsafe } = await client.query(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class r ON r.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = r.relnamespace
       WHERE c.contype = 'f' AND n.nspname = $1 AND rn.nspname <> $1`, [schema],
    );
    if (unsafe.length) throw new Error("Refusing restore tests with a foreign key outside the isolated schema");
    const url = new URL(process.env.DATABASE_URL!);
    // No public fallback: missing test tables must fail, never reach live data.
    url.searchParams.set("options", `-csearch_path=${schema}`);
    await run(schema, url.toString());
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    client.release(true);
    await pool.end();
  }
}