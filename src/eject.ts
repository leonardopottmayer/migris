import fs from "fs";
import path from "path";
import type { EnvironmentConfig } from "./config";
import type { DiscoveredMigration } from "./discovery";

/** Recursive directory copy, merging into an existing destination (overwrites files). */
export function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const CONFIG_TEMPLATE = {
  environments: {
    prod: {
      host: "localhost",
      port: 5432,
      user: "your_user",
      password: "your_password",
      database: "your_database",
    },
  },
};

/** Emits a placeholder config.json (module eject — a brand new service DB). */
export function writeConfigTemplate(outDir: string): void {
  fs.writeFileSync(
    path.join(outDir, "config.json"),
    JSON.stringify(CONFIG_TEMPLATE, null, 2) + "\n"
  );
}

/** Emits a config.json with a single environment derived from the tenant's, sans secret. */
export function writeConfigForEnv(outDir: string, envName: string, env: EnvironmentConfig): void {
  const config = {
    environments: {
      [envName]: { ...env, password: "" },
    },
  };
  fs.writeFileSync(path.join(outDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

function readPart(m: DiscoveredMigration, kind: "up" | "down"): string {
  const file = path.join(m.dir, `${m.id}.${kind}.sql`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/**
 * Collapses an ordered migration list into a single baseline migration (§11.3
 * `--squash`). Only sound for a brand-new database — it discards rollback
 * granularity and breaks cutover against an existing one.
 */
export function writeSquashBaseline(
  outMigrationsDir: string,
  migrations: DiscoveredMigration[]
): void {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  const id = `${timestamp}-baseline`;
  const dir = path.join(outMigrationsDir, id);
  fs.mkdirSync(dir, { recursive: true });

  const up = migrations
    .map((m) => `-- ${m.id}\n${readPart(m, "up").trimEnd()}\n`)
    .join("\n");
  const down = [...migrations]
    .reverse()
    .map((m) => `-- ${m.id}\n${readPart(m, "down").trimEnd()}\n`)
    .join("\n");

  fs.writeFileSync(path.join(dir, `${id}.up.sql`), up);
  fs.writeFileSync(path.join(dir, `${id}.down.sql`), down);
}
