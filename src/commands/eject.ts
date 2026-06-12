import fs from "fs";
import path from "path";
import { log } from "../logger";
import { MigrisError } from "../errors";
import {
  effectiveMigrations,
  discoverMigrations,
  hasTenant,
  listModules,
  byTimestamp,
  type DiscoveredMigration,
} from "../discovery";
import { loadRawConfig } from "../config";
import { findDrift } from "./drift";
import {
  copyDir,
  writeConfigTemplate,
  writeConfigForEnv,
  writeSquashBaseline,
} from "../eject";

export interface EjectOptions {
  module?: string;
  tenant?: string;
  out?: string;
  squash?: boolean;
}

/**
 * Extracts a slice of the project into a standalone migris (§11). Two orthogonal
 * axes: --module (vertical → service, drags `default`, keeps schema) and --tenant
 * (horizontal → resolved single-tenant project with ids preserved for cutover).
 * Both reuse the same resolution engine. Offline.
 */
export function eject(options: EjectOptions = {}): void {
  const root = process.cwd();
  const { module: moduleName, tenant, squash = false } = options;
  const out = options.out;

  if (!out) throw new MigrisError("--out <path> is required.");
  if (!moduleName && !tenant) {
    throw new MigrisError("Specify --module <m> and/or --tenant <env>.");
  }
  if (moduleName) {
    const modules = listModules(root);
    if (!modules.includes(moduleName)) {
      throw new MigrisError(
        `Module "${moduleName}" not found. Available: ${modules.join(", ") || "none"}`
      );
    }
  }
  if (tenant && !hasTenant(root, tenant)) {
    throw new MigrisError(`Tenant overlay "tenants/${tenant}" not found.`);
  }

  // Pre-check: freezing a fork that is behind the common version is a footgun.
  if (tenant) {
    const behind = findDrift(root, tenant);
    if (behind.length > 0) {
      log.warn(
        `${behind.length} overridden object(s) are behind the common version. ` +
          `Run "migris drift ${tenant}" and reconcile before freezing this state.`
      );
    }
  }

  const outDir = path.resolve(root, out);
  fs.mkdirSync(outDir, { recursive: true });
  const outMigrations = path.join(outDir, "migrations");
  const outObjects = path.join(outDir, "objects");

  // --- select the migration set ---
  const migrations = selectMigrations(root, moduleName, tenant);

  // --- write migrations (preserving module path + ids for cutover) ---
  if (squash) {
    writeSquashBaseline(outMigrations, migrations);
  } else {
    for (const m of migrations) {
      copyDir(m.dir, path.join(outMigrations, ...m.modulePath, m.id));
    }
  }

  // --- write objects (common base, then tenant overrides resolved on top) ---
  copyObjects(root, outObjects, moduleName, tenant);

  // --- config ---
  if (tenant && !moduleName) {
    const { environments } = loadRawConfig();
    const envConfig = environments[tenant];
    if (envConfig) writeConfigForEnv(outDir, tenant, envConfig);
    else writeConfigTemplate(outDir);
  } else {
    writeConfigTemplate(outDir);
  }

  log.success(`Ejected to ${path.relative(root, outDir) || outDir}`);
}

function selectMigrations(
  root: string,
  moduleName: string | undefined,
  tenant: string | undefined
): DiscoveredMigration[] {
  if (tenant) {
    let migrations = effectiveMigrations(root, tenant);
    if (moduleName) {
      const keep = new Set([moduleName, "default"]);
      migrations = migrations.filter((m) => m.modulePath[0] && keep.has(m.modulePath[0]));
    }
    return migrations;
  }
  // module-only (vertical): default + module from the common root.
  const keep = new Set([moduleName!, "default"]);
  return discoverMigrations(path.join(root, "migrations"), "common")
    .filter((m) => m.modulePath[0] && keep.has(m.modulePath[0]))
    .sort(byTimestamp);
}

function copyObjects(
  root: string,
  outObjects: string,
  moduleName: string | undefined,
  tenant: string | undefined
): void {
  const objectsRoot = path.join(root, "objects");
  if (moduleName) {
    copyDir(path.join(objectsRoot, "default"), path.join(outObjects, "default"));
    copyDir(path.join(objectsRoot, moduleName), path.join(outObjects, moduleName));
  } else {
    copyDir(objectsRoot, outObjects);
  }

  if (!tenant) return;
  const tenantObjects = path.join(root, "tenants", tenant, "objects");
  if (moduleName) {
    copyDir(path.join(tenantObjects, "default"), path.join(outObjects, "default"));
    copyDir(path.join(tenantObjects, moduleName), path.join(outObjects, moduleName));
  } else {
    copyDir(tenantObjects, outObjects);
  }
}
