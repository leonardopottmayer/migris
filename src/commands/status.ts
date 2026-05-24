import { createConnectedClient } from "../db";
import { log, isJsonMode } from "../logger";
import { MigrisError } from "../errors";

export interface StatusOptions {
  limit?: string;
  all?: boolean;
}

const STATUS_SYMBOLS: Record<string, string> = {
  A: "✓",
  R: "↩",
  E: "!",
};

function statusLabel(code: string): string {
  return STATUS_SYMBOLS[code] ?? "?";
}

export async function showMigrationStatus(
  envName: string,
  options: StatusOptions = {}
): Promise<void> {
  let client;
  try {
    client = await createConnectedClient(envName);
  } catch (err: any) {
    throw new MigrisError(`Could not connect to database: ${err.message}`);
  }

  try {
    const limitNum = options.all ? null : Math.max(1, parseInt(options.limit ?? "5", 10));
    const limitClause = limitNum ? `LIMIT ${limitNum}` : "";

    const batchesRes = await client.query<{ application_batch_id: number }>(
      `SELECT DISTINCT application_batch_id
       FROM migrations
       WHERE application_batch_id IS NOT NULL
       ORDER BY application_batch_id DESC
       ${limitClause}`
    );

    const batches = batchesRes.rows.map((r) => r.application_batch_id);

    if (batches.length === 0) {
      log.info("No migrations have been applied yet.");
      return;
    }

    const res = await client.query<{
      migration_id: string;
      status: string;
      updated_at: Date;
      application_batch_id: number;
    }>(
      `SELECT migration_id, status, updated_at, application_batch_id
       FROM migrations
       WHERE application_batch_id = ANY($1::int[])
       ORDER BY application_batch_id DESC, migration_id`,
      [batches]
    );

    type Row = { migration_id: string; status: string; updated_at: Date };
    const grouped = new Map<number, Row[]>();
    for (const row of res.rows) {
      const list = grouped.get(row.application_batch_id) ?? [];
      list.push(row);
      grouped.set(row.application_batch_id, list);
    }

    if (isJsonMode()) {
      const output = batches
        .sort((a, b) => b - a)
        .map((batchId) => ({
          batch: batchId,
          migrations: (grouped.get(batchId) ?? []).map((m) => ({
            migration_id: m.migration_id,
            status: m.status,
            updated_at: m.updated_at,
          })),
        }));
      process.stdout.write(JSON.stringify(output, null, 2) + "\n");
      return;
    }

    const label = options.all ? "All" : `Last ${batches.length}`;
    process.stdout.write(`\n📋 ${label} batch(es) — environment: ${envName}\n\n`);

    for (const batchId of batches.sort((a, b) => b - a)) {
      const rows = grouped.get(batchId) ?? [];
      process.stdout.write(`  Batch #${batchId}:\n`);
      for (const m of rows) {
        const sym = statusLabel(m.status);
        const ts = m.updated_at ? m.updated_at.toISOString().replace("T", " ").slice(0, 19) : "";
        process.stdout.write(`    [${sym}] ${m.migration_id}  ${ts}\n`);
      }
      process.stdout.write("\n");
    }
  } finally {
    await client.end();
  }
}
