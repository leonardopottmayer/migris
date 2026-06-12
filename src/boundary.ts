import fs from "fs";
import path from "path";
import {
  discoverMigrations,
  listModules,
  listTenants,
  hasTenant,
  type DiscoveredMigration,
} from "./discovery";
import { log } from "./logger";

/**
 * Boundary validation (§16.7): a migration inside module M must not reference a
 * schema belonging to another module (≠ M, ≠ default). The only legitimate
 * inter-module dependency is on `default`. This is a best-effort heuristic — not
 * a SQL parser — meant to catch accidental coupling so that eject stays safe.
 */

export interface BoundaryViolation {
  migrationId: string;
  module: string;
  referenced: string;
}

/** Removes comments and single-quoted string literals before scanning for tokens. */
function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/'(?:[^']|'')*'/g, " "); // single-quoted strings
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSql(dir: string, id: string, kind: "up" | "down"): string {
  const file = path.join(dir, `${id}.${kind}.sql`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function scanMigrations(
  migrations: DiscoveredMigration[],
  modules: string[]
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  for (const m of migrations) {
    const own = m.modulePath[0];
    if (!own) continue; // flat migration — no module boundary

    const sql = stripSql(readSql(m.dir, m.id, "up") + "\n" + readSql(m.dir, m.id, "down"));

    for (const other of modules) {
      if (other === own || other === "default") continue;
      const re = new RegExp(`\\b${escapeRegExp(other)}\\.`);
      if (re.test(sql)) {
        violations.push({ migrationId: m.id, module: own, referenced: other });
      }
    }
  }

  return violations;
}

/** Scans common + every tenant overlay for cross-module schema references. */
export function scanBoundaryViolations(projectRoot: string): BoundaryViolation[] {
  const modules = listModules(projectRoot);
  if (modules.length === 0) return []; // flat project — nothing to validate

  const all = discoverMigrations(path.join(projectRoot, "migrations"), "common");
  for (const tenant of listTenants(projectRoot)) {
    if (!hasTenant(projectRoot, tenant)) continue;
    all.push(
      ...discoverMigrations(path.join(projectRoot, "tenants", tenant, "migrations"), "overlay")
    );
  }

  return scanMigrations(all, modules);
}

/** Convenience used by `check`: emit warnings without failing. */
export function warnBoundaryViolations(projectRoot: string): void {
  for (const v of scanBoundaryViolations(projectRoot)) {
    log.warn(
      `Boundary: migration ${v.migrationId} (module ${v.module}) references schema "${v.referenced}." of another module.`
    );
  }
}
