import pg from "pg";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL to a PostgreSQL database whose user can create test schemas",
  );
const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 1,
});
try {
  const files = process.argv.slice(2);
  for (const file of files.length
    ? files
    : [
        "tests/api.test.js",
        "tests/rules.test.js",
        "tests/concurrency.test.js",
        "tests/content.test.js",
      ]) {
    const schema = "alsj_test_" + randomBytes(8).toString("hex");
    await pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    try {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--test", file], {
          stdio: "inherit",
          env: { ...process.env, TEST_DATABASE_URL: url.toString() },
        });
        child.on("error", reject);
        child.on("exit", resolve);
      });
      if (code !== 0) throw new Error(`PostgreSQL tests failed: ${file}`);
    } finally {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  }
} finally {
  await pool.end();
}
