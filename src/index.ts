#!/usr/bin/env node

import { Command } from "commander";
import { createMigration } from "./commands/create";
import { createObject } from "./commands/create-object";
import { applyMigrations } from "./commands/apply";
import { rollbackMigrations } from "./commands/rollback";
import { showMigrationStatus } from "./commands/status";
import { initProject } from "./commands/init";
import { checkMigrations } from "./commands/check";
import { validate } from "./commands/validate";
import { drift } from "./commands/drift";
import { environments } from "./commands/environments";
import { eject } from "./commands/eject";
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

// migris create <name> [--module <m>]
program
  .command("create")
  .argument("<name>", "Migration name in kebab-case (e.g. create-users-table).")
  .description("Creates a new migration folder with up.sql and down.sql files.")
  .option("--module <module>", "Module to create the migration under (required in modular projects).")
  .action(
    wrapAction((name: string, options: { module?: string }) =>
      createMigration(name, options)
    )
  );

// migris create-object <object> [name]
program
  .command("create-object")
  .argument("<object>", "Object identity (path under objects/ without .sql, e.g. notifications/views/v-not-pending).")
  .argument("[name]", "Migration name in kebab-case. Omit with --amend / --rebase.")
  .description("Compiles an object source file into a migration. Offline — never touches the database.")
  .option("--amend", "Rewrite the object's most recent migration in place (draft).")
  .option("--tenant <env>", "Compile from a tenant overlay (object override).")
  .option("--rebase", "Reconcile a tenant override: regenerate and advance forkedFrom to the current common version.")
  .option("--dry-run", "Print the up/down/meta that would be generated, without writing.")
  .action(
    wrapAction(
      (
        object: string,
        name: string | undefined,
        options: { amend?: boolean; tenant?: string; rebase?: boolean; dryRun?: boolean }
      ) => createObject(object, name, options)
    )
  );

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

// migris validate [--strict]
program
  .command("validate")
  .description("Checks module boundaries: flags cross-module schema references. Offline.")
  .option("--strict", "Exit non-zero if any boundary violation is found (CI gate).")
  .action(wrapAction((options: { strict?: boolean }) => validate(options)));

// migris drift <env>
program
  .command("drift")
  .argument("<env>", "Tenant environment to inspect.")
  .description("Lists overridden objects that fell behind the common version (fork radar). Offline.")
  .option("--strict", "Exit non-zero if any overridden object is behind (CI gate).")
  .action(wrapAction((env: string, options: { strict?: boolean }) => drift(env, options)));

// migris environments
program
  .command("environments")
  .description("Lists the environments declared in config.json (use --json for a CI matrix).")
  .action(wrapAction(() => environments()));

// migris eject [module]
program
  .command("eject")
  .argument("[module]", "Module to eject (sugar for --module <module>).")
  .description("Extracts a module and/or a tenant into a standalone migris project. Offline.")
  .option("--module <module>", "Module to eject (vertical: service + default).")
  .option("--tenant <env>", "Tenant to eject (horizontal: resolved single-tenant project).")
  .option("--out <path>", "Destination directory for the ejected project.")
  .option("--squash", "Collapse everything into a single baseline migration (new DB only).")
  .action(
    wrapAction(
      (
        moduleArg: string | undefined,
        options: { module?: string; tenant?: string; out?: string; squash?: boolean }
      ) => eject({ ...options, module: options.module ?? moduleArg })
    )
  );

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
