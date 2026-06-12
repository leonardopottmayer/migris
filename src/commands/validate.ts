import fs from "fs";
import path from "path";
import { log, isJsonMode } from "../logger";
import { MigrisError } from "../errors";
import { scanBoundaryViolations } from "../boundary";
import { listTenants } from "../discovery";
import { loadRawConfig } from "../config";

export interface ValidateOptions {
  strict?: boolean;
}

/**
 * Tenant overlay folders that have no matching environment in config.json
 * (§16.8 — orphan overlay). Best-effort: silently skipped when there is no
 * config.json (e.g. a generation-only checkout).
 */
function findOrphanOverlays(root: string): string[] {
  const tenants = listTenants(root);
  if (tenants.length === 0) return [];
  if (!fs.existsSync(path.join(root, "config.json"))) return [];
  const envs = new Set(Object.keys(loadRawConfig().environments));
  return tenants.filter((t) => !envs.has(t));
}

/**
 * Boundary validation command (§16.7). Reports cross-module schema references as
 * warnings by default; with --strict it exits non-zero (CI gate). Also flags
 * orphan tenant overlays (§16.8). Offline.
 */
export function validate(options: ValidateOptions = {}): void {
  const root = process.cwd();
  const violations = scanBoundaryViolations(root);
  const orphans = findOrphanOverlays(root);

  if (isJsonMode()) {
    process.stdout.write(
      JSON.stringify(
        { violation_count: violations.length, violations, orphan_overlays: orphans },
        null,
        2
      ) + "\n"
    );
  } else {
    if (violations.length === 0) {
      log.success("No boundary violations found.");
    } else {
      log.warn(`${violations.length} boundary violation(s):`);
      for (const v of violations) {
        process.stdout.write(
          `    - ${v.migrationId} (module ${v.module}) → references "${v.referenced}."\n`
        );
      }
    }
    for (const t of orphans) {
      log.warn(`Orphan overlay: tenants/${t}/ has no matching environment in config.json.`);
    }
  }

  if (options.strict && violations.length > 0) {
    throw new MigrisError("Boundary validation failed (--strict).", 1);
  }
}
