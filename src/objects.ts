import path from "path";
import { detectMode, collectAllIds } from "./discovery";

/**
 * Object identity helpers (§7.3, §16.6). An object's identity is its path
 * relative to the objects/ root, without the .sql extension — identical for the
 * common version and any tenant override.
 */

/** Source file for an object: objects/<object>.sql, or tenants/<env>/objects/<object>.sql. */
export function objectSourcePath(
  projectRoot: string,
  object: string,
  tenant?: string
): string {
  const base = tenant
    ? path.join(projectRoot, "tenants", tenant, "objects")
    : path.join(projectRoot, "objects");
  return path.join(base, `${object}.sql`);
}

/**
 * Destination module path for an object-migration (§16.6.2). In a modular
 * project it is the object's first segment; in an established flat project there
 * is no module. For an empty project (not yet established either way) the object
 * shape decides: a module/type/name identity (≥3 segments) bootstraps modular,
 * while type/name stays flat.
 */
export function resolveObjectModule(projectRoot: string, object: string): string[] {
  const segments = object.split("/");
  if (detectMode(projectRoot) === "modular") {
    return segments.length > 1 ? [segments[0]] : [];
  }
  const established = collectAllIds(projectRoot).size > 0;
  if (established) return []; // genuinely flat project
  return segments.length >= 3 ? [segments[0]] : []; // empty project — infer from shape
}

/**
 * Folder where an object-migration is written:
 * migrations/<module>/<leaf>, or tenants/<env>/migrations/<module>/<leaf>.
 */
export function migrationDirFor(
  projectRoot: string,
  modulePath: string[],
  leafName: string,
  tenant?: string
): string {
  const migrationsBase = tenant
    ? path.join(projectRoot, "tenants", tenant, "migrations")
    : path.join(projectRoot, "migrations");
  return path.join(migrationsBase, ...modulePath, leafName);
}
