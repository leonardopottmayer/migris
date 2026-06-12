import fs from "fs";
import path from "path";
import { createConnectedClient } from "../db";
import { log } from "../logger";
import { confirm } from "../prompt";
import { MigrisError } from "../errors";
import { effectiveMigrations } from "../discovery";

export interface RollbackOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export async function rollbackMigrations(
  envName: string,
  targetMigrationId?: string,
  options: RollbackOptions = {}
): Promise<void> {
  const { dryRun = false, yes = false } = options;

  // Resolve each migration_id to its folder on disk (across modules + overlay).
  const dirById = new Map(
    effectiveMigrations(process.cwd(), envName).map((m) => [m.id, m.dir])
  );

  let client;
  try {
    client = await createConnectedClient(envName);
  } catch (err: any) {
    throw new MigrisError(`Could not connect to database: ${err.message}`);
  }

  try {
    // Find the batch to roll back.
    let batchId: number | undefined;

    if (targetMigrationId) {
      const { rows } = await client.query<{ application_batch_id: number }>(
        `SELECT application_batch_id FROM migrations WHERE migration_id = $1`,
        [targetMigrationId]
      );
      batchId = rows[0]?.application_batch_id;
      if (!batchId) {
        throw new MigrisError(`Migration "${targetMigrationId}" not found or has no batch assigned.`);
      }
    } else {
      const { rows } = await client.query<{ application_batch_id: number }>(
        `SELECT MAX(application_batch_id) AS application_batch_id
         FROM migrations WHERE status = 'A'`
      );
      batchId = rows[0]?.application_batch_id;
    }

    if (!batchId) {
      log.info("No applied migrations to roll back.");
      return;
    }

    // All applied migrations from this batch onward, in reverse order.
    const { rows: migrationRows } = await client.query<{ migration_id: string }>(
      `SELECT migration_id FROM migrations
       WHERE application_batch_id >= $1 AND status = 'A'
       ORDER BY application_batch_id DESC, migration_id DESC`,
      [batchId]
    );

    const migrations = migrationRows.map((r) => r.migration_id);

    if (migrations.length === 0) {
      log.info("No applied migrations to roll back.");
      return;
    }

    if (dryRun) {
      log.info(`Dry run — ${migrations.length} migration(s) would be rolled back:`);
      migrations.forEach((m) => process.stdout.write(`    - ${m}\n`));
      return;
    }

    if (!yes) {
      const ok = await confirm(`${migrations.length} migration(s) will be rolled back. Continue?`);
      if (!ok) {
        log.info("Aborted.");
        return;
      }
    }

    for (const migrationId of migrations) {
      const dir = dirById.get(migrationId) ?? path.join(process.cwd(), "migrations", migrationId);
      const downPath = path.join(dir, `${migrationId}.down.sql`);

      if (!fs.existsSync(downPath)) {
        log.error(`down.sql not found for ${migrationId}`);
        throw new MigrisError(`Rollback stopped: missing down.sql for ${migrationId}.`);
      }

      const downSql = fs.readFileSync(downPath, "utf8");

      try {
        await client.query("BEGIN");
        await client.query(downSql);
        await client.query(
          `UPDATE migrations SET status = 'R', updated_at = NOW() WHERE migration_id = $1`,
          [migrationId]
        );
        await client.query("COMMIT");
        log.success(`Rolled back: ${migrationId}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        await client.query(
          `UPDATE migrations SET status = 'E', updated_at = NOW() WHERE migration_id = $1`,
          [migrationId]
        );
        log.error(`Failed to roll back ${migrationId}: ${err.message}`);
        throw new MigrisError(`Rollback stopped due to error in ${migrationId}.`);
      }
    }
  } finally {
    await client.end();
  }
}
