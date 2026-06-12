import fs from "fs";
import path from "path";
import { log, isJsonMode } from "../logger";
import { MigrisError } from "../errors";
import {
  discoverMigrations,
  objectLineage,
  hasTenant,
  type DiscoveredMigration,
} from "../discovery";

/**
 * Fork-drift radar (§10.4, §10.5). Offline: for each object the tenant overrides,
 * compare the explicit `forkedFrom` pointer of the latest override against the
 * latest common object-migration. If a newer common version exists, the fork is
 * behind — report it with the upstream diff. The alert never clears on its own;
 * only `create-object --rebase` advances the pointer.
 */

export interface BehindReport {
  object: string;
  forkedFrom: string | undefined;
  latestCommon: string;
  diff: string;
}

function readUp(m: DiscoveredMigration): string {
  return fs.readFileSync(path.join(m.dir, `${m.id}.up.sql`), "utf8");
}

/** Minimal LCS-based line diff for a readable upstream comparison. */
function lineDiff(base: string, current: string): string {
  const a = base.split("\n");
  const b = current.split("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`- ${a[i++]}`);
    } else {
      lines.push(`+ ${b[j++]}`);
    }
  }
  while (i < a.length) lines.push(`- ${a[i++]}`);
  while (j < b.length) lines.push(`+ ${b[j++]}`);
  return lines.join("\n");
}

function uniqueObjects(migrations: DiscoveredMigration[]): string[] {
  const seen = new Set<string>();
  for (const m of migrations) if (m.meta?.object) seen.add(m.meta.object);
  return [...seen].sort();
}

/** Pure computation of which overridden objects are behind the common version. */
export function findDrift(root: string, env: string): BehindReport[] {
  if (!hasTenant(root, env)) return [];

  const common = discoverMigrations(path.join(root, "migrations"), "common");
  const overlay = discoverMigrations(path.join(root, "tenants", env, "migrations"), "overlay");

  const behind: BehindReport[] = [];

  for (const object of uniqueObjects(overlay)) {
    const latestOverride = objectLineage(overlay, object).at(-1);
    const forkedFrom = latestOverride?.meta?.forkedFrom;

    const commonLineage = objectLineage(common, object);
    const latestCommon = commonLineage.at(-1);
    if (!latestCommon) continue; // pure tenant object — no upstream to drift from

    // Up to date when the pointer already references the latest common version.
    if (forkedFrom === latestCommon.id) continue;

    const baseMigration = forkedFrom
      ? commonLineage.find((m) => m.id === forkedFrom)
      : undefined;
    const diff = lineDiff(baseMigration ? readUp(baseMigration) : "", readUp(latestCommon));

    behind.push({ object, forkedFrom, latestCommon: latestCommon.id, diff });
  }

  return behind;
}

export interface DriftOptions {
  strict?: boolean;
}

export function drift(env: string, options: DriftOptions = {}): void {
  const root = process.cwd();

  if (!hasTenant(root, env)) {
    if (isJsonMode()) {
      process.stdout.write(JSON.stringify({ env, behind: [] }, null, 2) + "\n");
    } else {
      log.info(`No tenant overlay for "${env}" — nothing to check.`);
    }
    return;
  }

  const behind = findDrift(root, env);

  if (isJsonMode()) {
    process.stdout.write(JSON.stringify({ env, behind }, null, 2) + "\n");
  } else if (behind.length === 0) {
    log.success(`No fork drift for "${env}".`);
  } else {
    log.warn(`${behind.length} overridden object(s) behind the common version:`);
    for (const b of behind) {
      process.stdout.write(`\n  ${b.object}\n`);
      process.stdout.write(`    forked from: ${b.forkedFrom ?? "(none)"}\n`);
      process.stdout.write(`    latest common: ${b.latestCommon}\n`);
      process.stdout.write(`    upstream diff:\n`);
      for (const line of b.diff.split("\n")) process.stdout.write(`      ${line}\n`);
    }
  }

  // CI gate (§13.3): --strict turns a behind fork into a deploy blocker.
  if (options.strict && behind.length > 0) {
    throw new MigrisError(`Fork drift detected for "${env}" (--strict).`, 2);
  }
}
