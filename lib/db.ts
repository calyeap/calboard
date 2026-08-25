import { Pool, types } from "pg";

// DATE (OID 1082): keep as the raw "YYYY-MM-DD" string pg receives from
// Postgres rather than letting node-postgres construct a JS Date (which
// introduces local-timezone conversion bugs — see lib/portfolio.ts's
// priceDate fix for a real instance of exactly this class of bug).
types.setTypeParser(1082, (v) => v);
// INT8/BIGINT (OID 20): explicitly keep as string (this IS node-postgres's
// default — setting it explicitly here just makes the contract visible
// and future-proof against a global config change elsewhere).
types.setTypeParser(20, (v) => v);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — check .env.local");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
