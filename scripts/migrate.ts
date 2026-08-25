import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";
import { readFileSync } from "node:fs";
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

  const migrationFile = "001_portfolio_core.sql";
  const already = await pool.query(
    `SELECT 1 FROM schema_migrations WHERE filename = $1`,
    [migrationFile]
  );

  if (already.rows.length > 0) {
    console.log(`${migrationFile} already applied, skipping.`);
    await pool.end();
    return;
  }

  const sql = readFileSync(join(process.cwd(), "migrations", migrationFile), "utf-8");
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
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
