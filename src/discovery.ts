import fs from "fs";
import path from "path";
import { MigrisError } from "./errors";

/**
 * Filesystem-level discovery and resolution of migrations across modules and
 * tenant overlays. This is the shared engine reused by apply/rollback/check,
 * create-object, drift and eject. Everything here is pure filesystem — no
 * database access — so generation stays 100% offline.
 */

export interface MigrationMeta {
  /** Object identity (path relative to objects/ root, without .sql). */
  object?: string;
  /** SHA-256 of the object source file at generation time. */
  sourceChecksum?: string;
  /** Tenant overrides only: migration_id of the common version this fork is based on. */
  forkedFrom?: string;
}

export interface DiscoveredMigration {
  /** Leaf folder name — this is the migration_id (global, no module/tenant in it). */
  id: string;
  /** Absolute path to the leaf folder. */
  dir: string;
  /** Path segments between migrations/ and the leaf (e.g. ["notifications"]); [] in flat. */
  modulePath: string[];
  /** Whether it came from the common root or a tenant overlay. */
  source: "common" | "overlay";
  /** Parsed {id}.meta.json, when present (object-migrations carry it). */
  meta?: MigrationMeta;
}

export type ProjectMode = "flat" | "modular";

const TIMESTAMP_RE = /^(\d{14})/;

/** A leaf migration folder is one that contains `${folderName}.up.sql`. */
function isLeaf(dir: string): boolean {
  const name = path.basename(dir);
  return fs.existsSync(path.join(dir, `${name}.up.sql`));
}

function readMeta(dir: string, name: string): MigrationMeta | undefined {
  const metaPath = path.join(dir, `${name}.meta.json`);
  if (!fs.existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as MigrationMeta;
  } catch {
    throw new MigrisError(`Invalid JSON in ${name}.meta.json`);
  }
}

/**
 * Recursively walks a migrations root collecting leaf folders. Intermediate
 * folders (module names) are just organization and never become migrations.
 */
export function discoverMigrations(
  migrationsRoot: string,
  source: "common" | "overlay"
): DiscoveredMigration[] {
  const out: DiscoveredMigration[] = [];
  if (!fs.existsSync(migrationsRoot)) return out;

  const collect = (relSegments: string[]): void => {
    const currentAbs = path.join(migrationsRoot, ...relSegments);
    for (const entry of fs.readdirSync(currentAbs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const childAbs = path.join(currentAbs, entry.name);
      if (isLeaf(childAbs)) {
        out.push({
          id: entry.name,
          dir: childAbs,
          modulePath: relSegments,
          source,
          meta: readMeta(childAbs, entry.name),
        });
      } else {
        collect([...relSegments, entry.name]);
      }
    }
  };

  collect([]);
  return out;
}

/**
 * Detects the project mode from structure (§16.8), keyed off actual leaf
 * migrations so that empty folders don't count: any direct leaf → flat; only
 * leaves nested under module folders → modular; no leaves at all → flat.
 */
export function detectMode(projectRoot: string): ProjectMode {
  const migrationsDir = path.join(projectRoot, "migrations");
  if (!fs.existsSync(migrationsDir)) return "flat";

  const all = discoverMigrations(migrationsDir, "common");
  if (all.length === 0) return "flat";
  if (all.some((m) => m.modulePath.length === 0)) return "flat"; // a direct leaf exists
  return "modular";
}

/** Module names that actually contain migrations (first path segment); [] in flat. */
export function listModules(projectRoot: string): string[] {
  if (detectMode(projectRoot) !== "modular") return [];
  const all = discoverMigrations(path.join(projectRoot, "migrations"), "common");
  return [...new Set(all.map((m) => m.modulePath[0]).filter(Boolean))].sort();
}

export function hasTenant(projectRoot: string, env: string): boolean {
  return fs.existsSync(path.join(projectRoot, "tenants", env));
}

export function listTenants(projectRoot: string): string[] {
  const tenantsDir = path.join(projectRoot, "tenants");
  if (!fs.existsSync(tenantsDir)) return [];
  return fs
    .readdirSync(tenantsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function timestampOf(id: string): string {
  const m = id.match(TIMESTAMP_RE);
  return m ? m[1] : "";
}

/** Merge-sort comparator: chronological by 14-digit prefix, tiebreak by id (§6.2). */
export function byTimestamp(a: DiscoveredMigration, b: DiscoveredMigration): number {
  const ta = timestampOf(a.id);
  const tb = timestampOf(b.id);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Effective migration list for an environment, with override suppression (§16.4):
 * common + overlay, dropping the common object-migrations whose object the tenant
 * overrides, sorted by timestamp. Single source of truth for apply/rollback/check
 * and tenant eject.
 */
export function effectiveMigrations(projectRoot: string, env: string): DiscoveredMigration[] {
  const common = discoverMigrations(path.join(projectRoot, "migrations"), "common");
  const overlay = hasTenant(projectRoot, env)
    ? discoverMigrations(path.join(projectRoot, "tenants", env, "migrations"), "overlay")
    : [];

  const overridden = new Set(
    overlay.map((m) => m.meta?.object).filter((o): o is string => Boolean(o))
  );

  const filteredCommon = common.filter(
    (m) => !(m.meta?.object && overridden.has(m.meta.object))
  );

  return [...filteredCommon, ...overlay].sort(byTimestamp);
}

/** Every migration_id across common + all tenant overlays (for global uniqueness §16.1). */
export function collectAllIds(projectRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const m of discoverMigrations(path.join(projectRoot, "migrations"), "common")) {
    ids.add(m.id);
  }
  for (const tenant of listTenants(projectRoot)) {
    const root = path.join(projectRoot, "tenants", tenant, "migrations");
    for (const m of discoverMigrations(root, "overlay")) ids.add(m.id);
  }
  return ids;
}

/** Object-migrations for a given object identity, chronologically ordered (§8.1). */
export function objectLineage(
  migrations: DiscoveredMigration[],
  object: string
): DiscoveredMigration[] {
  return migrations.filter((m) => m.meta?.object === object).sort(byTimestamp);
}
