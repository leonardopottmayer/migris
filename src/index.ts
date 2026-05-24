#!/usr/bin/env node

import { Command } from "commander";
import { createMigration } from "./commands/create";
import { applyMigrations } from "./commands/apply";
import { rollbackMigrations } from "./commands/rollback";
import { showMigrationStatus } from "./commands/status";
import { initProject } from "./commands/init";
import { checkMigrations } from "./commands/check";
import { setJsonMode } from "./logger";
import { MigrisError } from "./errors";

function wrapAction<T extends unknown[]>(
  fn: (...args: T) => Promise<void> | void
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (err instanceof MigrisError) {
        if (err.message) process.stderr.write(`❌ ${err.message}\n`);
        process.exit(err.exitCode);
      }
      // Unexpected errors — show full stack in development.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`❌ Unexpected error: ${msg}\n`);
      process.exit(1);
    }
  };
}

const program = new Command();

program
  .name("migris")
  .description("Migris: CLI tool for managing PostgreSQL database migrations.")
  .version("1.0.0")
  .option("--json", "Output results in JSON format (useful for CI/scripts).")
  .hook("preAction", () => {
    if (program.opts()["json"]) setJsonMode(true);
  });

// migris init [env]
program
  .command("init")
  .argument("[env]", "Environment to create the migrations table in.")
  .description(
    "Initialize project: creates config.json template, migrations/ directory, and optionally the migrations table."
  )
  .action(wrapAction(initProject));

// migris create <name>
program
  .command("create")
  .argument("<name>", "Migration name in kebab-case (e.g. create-users-table).")
  .description("Creates a new migration folder with up.sql and down.sql files.")
  .action(wrapAction(createMigration));

// migris apply <env>
program
  .command("apply")
  .argument("<env>", "Environment name from config.json.")
  .description("Applies all pending migrations.")
  .option("--dry-run", "Preview what would be applied without executing.")
  .option("-y, --yes", "Skip confirmation prompt.")
  .action(
    wrapAction((env: string, options: { dryRun?: boolean; yes?: boolean }) =>
      applyMigrations(env, options)
    )
  );

// migris rollback <env> [migration_id]
program
  .command("rollback")
  .argument("<env>", "Environment name from config.json.")
  .argument(
    "[migration_id]",
    "Roll back all batches starting from this migration's batch. Defaults to the last batch."
  )
  .description("Rolls back the last applied batch, or all batches from a given migration onward.")
  .option("--dry-run", "Preview what would be rolled back without executing.")
  .option("-y, --yes", "Skip confirmation prompt.")
  .action(
    wrapAction(
      (env: string, migrationId: string | undefined, options: { dryRun?: boolean; yes?: boolean }) =>
        rollbackMigrations(env, migrationId, options)
    )
  );

// migris status <env>
program
  .command("status")
  .argument("<env>", "Environment name from config.json.")
  .description("Shows migration status grouped by batch.")
  .option("--limit <n>", "Number of recent batches to show.", "5")
  .option("--all", "Show all batches (overrides --limit).")
  .action(
    wrapAction((env: string, options: { limit?: string; all?: boolean }) =>
      showMigrationStatus(env, options)
    )
  );

// migris check <env>
program
  .command("check")
  .argument("<env>", "Environment name from config.json.")
  .description(
    "Checks if all migrations are applied. Exits with code 2 if there are pending migrations (useful in CI pipelines)."
  )
  .action(wrapAction(checkMigrations));

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
