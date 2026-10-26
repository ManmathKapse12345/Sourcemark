import { execSync } from "node:child_process";

// Applies migrations to the test database (created if missing). Never points at the dev database.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://sourcemark:sourcemark@localhost:5434/sourcemark_test";
  if (!/_test\b/.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
