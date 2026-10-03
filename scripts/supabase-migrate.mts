// Applies supabase/migrations/*.sql in name order, in one transaction. Every file is idempotent, so there is
// no tracking table: re-running is safe. Needs SUPABASE_DB_URL (session pooler); never imported by app code.
// `pnpm db:migrate` targets the test project (.env.local), `pnpm db:migrate:prod` the production one
// (.env.production.local). The target project is printed first, so a wrong env file is easy to spot.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL is not set. Copy the session pooler connection string from Supabase → Connect into .env.",
  );
  process.exit(1);
}

// the session pooler's user is `postgres.<project ref>`
const ref = (() => {
  try {
    return decodeURIComponent(new URL(dbUrl).username).split(".")[1] ?? "unknown";
  } catch {
    return "unknown";
  }
})();
console.log(`Migrating Supabase project ${ref}`);

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  await client.query("begin");
  for (const file of files) {
    console.log(file);
    await client.query(await readFile(join(dir, file), "utf8"));
  }
  await client.query("commit");
  console.log(`Applied ${files.length} migration file(s).`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Migration failed, rolled back:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
