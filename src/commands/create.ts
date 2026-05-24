import fs from "fs";
import path from "path";
import { log } from "../logger";
import { MigrisError } from "../errors";

const VALID_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createMigration(name: string): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new MigrisError(
      `Invalid migration name "${name}".\n` +
        `Use lowercase kebab-case with letters and digits only (e.g. create-users-table).`
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(0, 14);

  const migrationName = `${timestamp}-${name}`;
  const dir = path.join(process.cwd(), "migrations", migrationName);

  if (fs.existsSync(dir)) {
    throw new MigrisError(`Migration directory already exists: ${dir}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${migrationName}.up.sql`), `-- ${migrationName}.up.sql\n`);
  fs.writeFileSync(path.join(dir, `${migrationName}.down.sql`), `-- ${migrationName}.down.sql\n`);

  log.success(`Migration created: migrations/${migrationName}`);
}
