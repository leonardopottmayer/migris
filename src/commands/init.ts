import fs from "fs";
import path from "path";
import { createConnectedClient } from "../db";
import { log } from "../logger";
import { MigrisError } from "../errors";

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS migrations (
  migration_id         VARCHAR(255) PRIMARY KEY,
  status               CHAR(1)     NOT NULL,
  updated_at           TIMESTAMP,
  application_batch_id INTEGER,
  checksum             VARCHAR(64)
);

-- Add checksum column for existing installations that predate this column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'migrations' AND column_name = 'checksum'
  ) THEN
    ALTER TABLE migrations ADD COLUMN checksum VARCHAR(64);
  END IF;
END $$;
`;

const CONFIG_TEMPLATE = {
  environments: {
    dev: {
      host: "localhost",
      port: 5432,
      user: "your_user",
      password: "your_password",
      database: "your_database",
    },
  },
};

export async function initProject(envName?: string): Promise<void> {
  const configPath = path.join(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n");
    log.success("Created config.json — fill in your database credentials.");
  } else {
    log.info("config.json already exists, skipping.");
  }

  const migrationsDir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    log.success("Created migrations/ directory.");
  } else {
    log.info("migrations/ directory already exists, skipping.");
  }

  if (!envName) {
    log.info('Tip: run "migris init <env>" to also create the migrations table in your database.');
    return;
  }

  let client;
  try {
    client = await createConnectedClient(envName);
  } catch (err: any) {
    throw new MigrisError(`Could not connect to database: ${err.message}`);
  }

  try {
    await client.query(MIGRATIONS_TABLE_SQL);
    log.success(`Migrations table created/verified on environment "${envName}".`);
  } finally {
    await client.end();
  }
}
