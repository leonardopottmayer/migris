import fs from "fs";
import path from "path";
import { log } from "../logger";
import { MigrisError } from "../errors";
import { computeChecksum } from "../checksum";
import {
  discoverMigrations,
  objectLineage,
  collectAllIds,
  type DiscoveredMigration,
  type MigrationMeta,
} from "../discovery";
import { objectSourcePath, resolveObjectModule, migrationDirFor } from "../objects";

const VALID_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface CreateObjectOptions {
  amend?: boolean;
  tenant?: string;
  rebase?: boolean;
  dryRun?: boolean;
}

const V1_DOWN_PLACEHOLDER = (id: string): string =>
  `-- ${id}.down.sql\n` +
  `-- First version of this object: write the rollback yourself (usually a DROP ...).\n` +
  `-- From v2 on, migris generates this file automatically from the previous version.\n`;

function readUp(m: DiscoveredMigration): string {
  return fs.readFileSync(path.join(m.dir, `${m.id}.up.sql`), "utf8");
}

/**
 * Compiles an object source file into a migration (§8, §16.6). 100% offline:
 * never connects to a database and never parses the object's SQL.
 */
export function createObject(
  object: string,
  name: string | undefined,
  options: CreateObjectOptions = {}
): void {
  const { amend = false, tenant, rebase = false, dryRun = false } = options;
  const root = process.cwd();

  // --- argument sanity ---
  if (rebase && !tenant) {
    throw new MigrisError("--rebase only applies to tenant overrides (use it with --tenant <env>).");
  }
  if (amend && rebase) {
    throw new MigrisError("Use either --amend or --rebase, not both.");
  }
  const inPlace = amend || rebase;
  if (inPlace && name) {
    throw new MigrisError(
      `Do not pass a migration name with ${rebase ? "--rebase" : "--amend"} — it rewrites the most recent migration in place.`
    );
  }
  if (!inPlace) {
    if (!name) throw new MigrisError("A migration name is required (or use --amend / --rebase).");
    if (!VALID_NAME_RE.test(name)) {
      throw new MigrisError(
        `Invalid migration name "${name}". Use lowercase kebab-case (e.g. add-pending-view).`
      );
    }
  }

  // --- resolve source ---
  const sourcePath = objectSourcePath(root, object, tenant);
  if (!fs.existsSync(sourcePath)) {
    throw new MigrisError(`Object source not found: ${path.relative(root, sourcePath)}`);
  }
  const sourceContent = fs.readFileSync(sourcePath, "utf8");
  const sourceChecksum = computeChecksum(sourceContent);

  const modulePath = resolveObjectModule(root, object);

  // --- lineage (the tenant owns its own override lineage, §10.3) ---
  const commonMigrations = discoverMigrations(path.join(root, "migrations"), "common");
  const commonLineage = objectLineage(commonMigrations, object);

  const targetMigrations = tenant
    ? discoverMigrations(path.join(root, "tenants", tenant, "migrations"), "overlay")
    : commonMigrations;
  const lineage = objectLineage(targetMigrations, object);

  // The version whose up.sql becomes our down.sql.
  const previous = inPlace ? lineage.at(-2) : lineage.at(-1);
  const downContent = previous ? readUp(previous) : null; // null → v1 placeholder

  // --- forkedFrom pointer (override only, §10.5) ---
  let forkedFrom: string | undefined;
  if (tenant) {
    const latestCommonId = commonLineage.at(-1)?.id;
    if (rebase) {
      forkedFrom = latestCommonId; // advance the pointer (reconcile)
    } else if (lineage.length === 0) {
      forkedFrom = latestCommonId; // first fork
    } else {
      // Regenerating an existing override: preserve the pointer so drift never
      // clears on its own.
      forkedFrom = lineage.at(-1)?.meta?.forkedFrom;
    }
  }

  const meta: MigrationMeta = { object, sourceChecksum };
  if (tenant) meta.forkedFrom = forkedFrom;

  // --- determine destination ---
  let id: string;
  let dir: string;
  if (inPlace) {
    const target = lineage.at(-1);
    if (!target) {
      throw new MigrisError(
        `No existing migration for object "${object}"${tenant ? ` in tenant "${tenant}"` : ""} to ${rebase ? "rebase" : "amend"}.`
      );
    }
    id = target.id;
    dir = target.dir;
  } else {
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    id = `${timestamp}-${name}`;
    if (collectAllIds(root).has(id)) {
      throw new MigrisError(`Migration id already exists in this project: ${id}`);
    }
    dir = migrationDirFor(root, modulePath, id, tenant);
  }

  const upContent = sourceContent;
  const finalDown = downContent ?? V1_DOWN_PLACEHOLDER(id);

  if (dryRun) {
    log.info(`Dry run — would ${inPlace ? "rewrite" : "create"} ${path.relative(root, dir)}`);
    process.stdout.write(`\n--- ${id}.up.sql ---\n${upContent}\n`);
    process.stdout.write(`\n--- ${id}.down.sql ---\n${finalDown}\n`);
    process.stdout.write(`\n--- ${id}.meta.json ---\n${JSON.stringify(meta, null, 2)}\n`);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.up.sql`), upContent);
  fs.writeFileSync(path.join(dir, `${id}.down.sql`), finalDown);
  fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + "\n");

  const verb = inPlace ? (rebase ? "Rebased" : "Amended") : "Created";
  log.success(`${verb} object migration: ${path.relative(root, dir)}`);
}
