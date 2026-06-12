import fs from "fs";
import path from "path";
import os from "os";

/** Creates a fresh temporary project root. */
export function makeTmpProject(prefix = "migris-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface MigrationSpec {
  id: string;
  up?: string;
  down?: string;
  meta?: Record<string, unknown>;
  module?: string;
  tenant?: string;
}

/** Writes a migration folder (common or overlay, flat or modular). Returns its dir. */
export function writeMigration(root: string, spec: MigrationSpec): string {
  const base = spec.tenant
    ? path.join(root, "tenants", spec.tenant, "migrations")
    : path.join(root, "migrations");
  const dir = spec.module ? path.join(base, spec.module, spec.id) : path.join(base, spec.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${spec.id}.up.sql`), spec.up ?? "SELECT 1;");
  fs.writeFileSync(path.join(dir, `${spec.id}.down.sql`), spec.down ?? "SELECT 0;");
  if (spec.meta) {
    fs.writeFileSync(path.join(dir, `${spec.id}.meta.json`), JSON.stringify(spec.meta, null, 2) + "\n");
  }
  return dir;
}

export interface ObjectSpec {
  object: string;
  content: string;
  tenant?: string;
}

/** Writes an object source file under objects/ or tenants/<env>/objects/. Returns its path. */
export function writeObjectSource(root: string, spec: ObjectSpec): string {
  const base = spec.tenant
    ? path.join(root, "tenants", spec.tenant, "objects")
    : path.join(root, "objects");
  const file = path.join(base, `${spec.object}.sql`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, spec.content);
  return file;
}

/** Writes a config.json with the given environments. */
export function writeConfig(root: string, environments: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(root, "config.json"),
    JSON.stringify({ environments }, null, 2) + "\n"
  );
}

/** Reads an object-migration's meta.json by folder id, searching common + a tenant overlay. */
export function readMetaOf(root: string, id: string, opts: { tenant?: string; module?: string } = {}): Record<string, unknown> {
  const base = opts.tenant
    ? path.join(root, "tenants", opts.tenant, "migrations")
    : path.join(root, "migrations");
  const dir = opts.module ? path.join(base, opts.module, id) : path.join(base, id);
  return JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), "utf8"));
}
