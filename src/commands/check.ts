import fs from "fs";
import path from "path";
import { createConnectedClient } from "../db";
import { log, isJsonMode } from "../logger";
import { MigrisError } from "../errors";

/**
 * Compares migrations on disk with those applied in the database.
 *
 * Exit codes:
 *   0 — all migrations are applied (up to date)
 *   2 — there are pending migrations
 */
export async function checkMigrations(envName: string): Promise<void> {
  const migrationsDir = path.join(process.cwd(), "migrations");

  if (!fs.existsSync(migrationsDir)) {
    throw new MigrisError('migrations/ directory not found. Run "migris init" first.');
  }

  const onDisk = fs
    .readdirSync(migrationsDir)
    .filter((e) => fs.statSync(path.join(migrationsDir, e)).isDirectory())
    .sort();

  let client;
  try {
    client = await createConnectedClient(envName);
  } catch (err: any) {
    throw new MigrisError(`Could not connect to database: ${err.message}`);
  }

  try {
    const { rows } = await client.query<{ migration_id: string }>(
      `SELECT migration_id FROM migrations WHERE status = 'A'`
    );
    const applied = new Set(rows.map((r) => r.migration_id));
    const pending = onDisk.filter((m) => !applied.has(m));

    if (isJsonMode()) {
      process.stdout.write(
        JSON.stringify({ pending_count: pending.length, pending }, null, 2) + "\n"
      );
    } else if (pending.length === 0) {
      log.success("All migrations are up to date.");
    } else {
      log.warn(`${pending.length} pending migration(s):`);
      pending.forEach((m) => process.stdout.write(`    - ${m}\n`));
    }

    // Exit code 2 signals "pending migrations" to CI systems.
    if (pending.length > 0) {
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}
