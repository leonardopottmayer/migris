import fs from "fs";
import path from "path";
import { createConnectedClient } from "../db";
import { computeChecksum } from "../checksum";
import { log } from "../logger";
import { confirm } from "../prompt";
import { MigrisError } from "../errors";
import { effectiveMigrations } from "../discovery";

export interface ApplyOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export async function applyMigrations(envName: string, options: ApplyOptions = {}): Promise<void> {
  const { dryRun = false, yes = false } = options;
  const migrationsDir = path.join(process.cwd(), "migrations");

  if (!fs.existsSync(migrationsDir)) {
    throw new MigrisError('migrations/ directory not found. Run "migris init" first.');
  }

  // Effective list: common + tenant overlay (with override suppression), merge-sorted
  // by timestamp. For a flat single-tenant project this is identical to today's
  // one-level listing.
  const migrations = effectiveMigrations(process.cwd(), envName);
  const folders = migrations.map((m) => m.id);
  const dirById = new Map(migrations.map((m) => [m.id, m.dir]));

  // Validate that every migration folder has both up.sql and down.sql.
  const invalid: string[] = [];
  for (const m of migrations) {
    const hasUp = fs.existsSync(path.join(m.dir, `${m.id}.up.sql`));
    const hasDown = fs.existsSync(path.join(m.dir, `${m.id}.down.sql`));
    if (!hasUp || !hasDown) invalid.push(m.id);
  }

  if (invalid.length > 0) {
    log.error("Incomplete migrations (missing up.sql or down.sql):");
    invalid.forEach((f) => process.stderr.write(`    - ${f}\n`));
    throw new MigrisError("Aborting apply.");
  }

  let client;
  try {
    client = await createConnectedClient(envName);
  } catch (err: any) {
    throw new MigrisError(`Could not connect to database: ${err.message}`);
  }

  try {
    const { rows: batchRows } = await client.query<{ max: number | null }>(
      `SELECT MAX(application_batch_id) AS max FROM migrations`
    );
    const newBatch = (batchRows[0]?.max ?? 0) + 1;

    // Identify pending migrations (not applied or previously rolled back/errored).
    const pending: string[] = [];
    for (const folder of folders) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM migrations WHERE migration_id = $1 AND status = 'A'`,
        [folder]
      );
      if ((rowCount ?? 0) > 0) {
        // Already applied — warn if the file checksum changed.
        const { rows } = await client.query<{ checksum: string | null }>(
          `SELECT checksum FROM migrations WHERE migration_id = $1`,
          [folder]
        );
        const recorded = rows[0]?.checksum;
        if (recorded) {
          const current = computeChecksum(
            fs.readFileSync(path.join(dirById.get(folder)!, `${folder}.up.sql`), "utf8")
          );
          if (current !== recorded) {
            log.warn(`Checksum mismatch on already-applied migration: ${folder}`);
          }
        }
        continue;
      }
      pending.push(folder);
    }

    if (pending.length === 0) {
      log.info("No pending migrations.");
      return;
    }

    if (dryRun) {
      log.info(`Dry run — ${pending.length} migration(s) would be applied:`);
      pending.forEach((m) => process.stdout.write(`    + ${m}\n`));
      return;
    }

    if (!yes) {
      const ok = await confirm(`${pending.length} migration(s) will be applied. Continue?`);
      if (!ok) {
        log.info("Aborted.");
        return;
      }
    }

    for (const folder of pending) {
      const upSql = fs.readFileSync(
        path.join(dirById.get(folder)!, `${folder}.up.sql`),
        "utf8"
      );
      const checksum = computeChecksum(upSql);

      try {
        await client.query("BEGIN");
        await client.query(upSql);
        await client.query(
          `INSERT INTO migrations (migration_id, status, updated_at, application_batch_id, checksum)
           VALUES ($1, 'A', NOW(), $2, $3)
           ON CONFLICT (migration_id)
           DO UPDATE SET status = 'A', updated_at = NOW(), application_batch_id = $2, checksum = $3`,
          [folder, newBatch, checksum]
        );
        await client.query("COMMIT");
        log.success(`Applied: ${folder}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        await client.query(
          `INSERT INTO migrations (migration_id, status, updated_at)
           VALUES ($1, 'E', NOW())
           ON CONFLICT (migration_id) DO UPDATE SET status = 'E', updated_at = NOW()`,
          [folder]
        );
        log.error(`Failed to apply ${folder}: ${err.message}`);
        throw new MigrisError(`Apply stopped due to error in ${folder}.`);
      }
    }
  } finally {
    await client.end();
  }
}
