import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set in .env.local");
  }
  const pool = new Pool({ connectionString });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = join(process.cwd(), "migrations");

  // Every .sql file in migrations/, in filename order. The numeric prefix is
  // what orders them (001_, 002_, ...), and later migrations may depend on
  // objects created by earlier ones, so the sort is load-bearing rather than
  // cosmetic. Sorted explicitly because readdirSync's order is filesystem-
  // dependent and not guaranteed.
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (migrationFiles.length === 0) {
    throw new Error(`No .sql files found in ${migrationsDir}`);
  }

  const applied = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`
  );
  const alreadyApplied = new Set(applied.rows.map((r) => r.filename));

  const pending = migrationFiles.filter((f) => !alreadyApplied.has(f));

  if (pending.length === 0) {
    console.log(
      `All ${migrationFiles.length} migration(s) already applied, nothing to do.`
    );
    await pool.end();
    return;
  }

  try {
    // One transaction per migration, not one for the whole batch: a failure in
    // 002 must not roll back a 001 that applied cleanly, or the recorded state
    // and the actual schema disagree on the next run.
    for (const migrationFile of pending) {
      const sql = readFileSync(join(migrationsDir, migrationFile), "utf-8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [migrationFile]
        );
        await client.query("COMMIT");
        console.log(`${migrationFile} applied successfully.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`${migrationFile} failed — rolled back.`);
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
