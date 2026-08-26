import { config } from "dotenv";
config({ path: ".env.local" });

// Integration tests TRUNCATE tables in beforeEach hooks. Refuse to run
// unless DATABASE_URL is pointed at an isolated *_test database — otherwise
// a plain `npm run test` would silently wipe the dev database (which, from
// Task 11 onward, holds the user's real, irreplaceable financial ledger).
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set — refusing to run integration tests against the dev database"
  );
}
const dbName = new URL(url).pathname.slice(1);
if (!/_test$/.test(dbName)) {
  throw new Error(
    `Refusing to TRUNCATE '${dbName}' — TEST_DATABASE_URL must point at a *_test database`
  );
}
process.env.DATABASE_URL = url;

import "@testing-library/jest-dom/vitest";
