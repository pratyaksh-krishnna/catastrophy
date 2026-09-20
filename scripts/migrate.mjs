import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const useTestDatabase = process.argv.includes("--test");
const databaseUrl = useTestDatabase ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`${useTestDatabase ? "DATABASE_URL_TEST" : "DATABASE_URL"} is required for migrations`);

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(2134583450)");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  for (const name of files) {
    const source = await readFile(path.join(directory, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`${name} changed after it was applied`);
      continue;
    }

    if (name === "0000_init.sql") {
      const schema = await client.query("SELECT to_regclass('public.societies') AS table_name");
      if (schema.rows[0]?.table_name && process.env.BASELINE_EXISTING_SCHEMA !== "1") {
        throw new Error("Existing schema found. Set BASELINE_EXISTING_SCHEMA=1 once after verifying it matches 0000_init.sql");
      }
      if (schema.rows[0]?.table_name) {
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
        console.log(`Baselined ${name}`);
        continue;
      }
    }

    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(2134583450)");
  await client.end();
}
