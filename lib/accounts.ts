import { getPool } from "./db";
import type { Pool, PoolClient } from "pg";

export interface Account {
  id: number;
  name: string;
  custodian: string | null;
}

export async function createAccount(
  name: string,
  custodian: string | null,
  client?: PoolClient
): Promise<Account> {
  const db: Pool | PoolClient = client ?? getPool();
  const result = await db.query<Account>(
    `INSERT INTO accounts (name, custodian) VALUES ($1, $2) RETURNING id, name, custodian`,
    [name, custodian]
  );
  return result.rows[0];
}

export async function listAccounts(): Promise<Account[]> {
  const pool = getPool();
  const result = await pool.query<Account>(
    `SELECT id, name, custodian FROM accounts WHERE is_active = TRUE ORDER BY name`
  );
  return result.rows;
}
