import fs from "fs";
import path from "path";
import { log } from "../logger";
import { MigrisError } from "../errors";
import { collectAllIds, detectMode } from "../discovery";

const VALID_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface CreateOptions {
  module?: string;
}

export function createMigration(name: string, options: CreateOptions = {}): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new MigrisError(
      `Invalid migration name "${name}".\n` +
        `Use lowercase kebab-case with letters and digits only (e.g. create-users-table).`
    );
  }

  const moduleName = options.module;
  const mode = detectMode(process.cwd());
  // "Established" = at least one migration already exists, so the mode is committed.
  // An empty project is reported as flat but may still be bootstrapped into modular
  // by passing --module on the first migration.
  const established = collectAllIds(process.cwd()).size > 0;

  if (mode === "modular" && !moduleName) {
    throw new MigrisError(
      `This is a modular project — specify a module with --module <name> (e.g. --module identity).`
    );
  }
  if (mode === "flat" && established && moduleName) {
    throw new MigrisError(
      `This is a flat project — --module is not allowed. Create a module by placing migrations under migrations/<module>/.`
    );
  }
  if (moduleName && !VALID_NAME_RE.test(moduleName)) {
    throw new MigrisError(
      `Invalid module name "${moduleName}". Use lowercase kebab-case (e.g. notifications).`
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

  const migrationName = `${timestamp}-${name}`;

  // migration_id is the leaf folder name and must be globally unique (§16.1).
  if (collectAllIds(process.cwd()).has(migrationName)) {
    throw new MigrisError(`Migration id already exists in this project: ${migrationName}`);
  }

  const relParts = moduleName ? ["migrations", moduleName, migrationName] : ["migrations", migrationName];
  const dir = path.join(process.cwd(), ...relParts);

  if (fs.existsSync(dir)) {
    throw new MigrisError(`Migration directory already exists: ${dir}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${migrationName}.up.sql`), `-- ${migrationName}.up.sql\n`);
  fs.writeFileSync(path.join(dir, `${migrationName}.down.sql`), `-- ${migrationName}.down.sql\n`);

  log.success(`Migration created: ${relParts.join("/")}`);
}
