import fs from "fs";
import path from "path";
import { MigrisError } from "./errors";

export interface EnvironmentConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface MigrisConfig {
  environments: Record<string, EnvironmentConfig>;
}

/**
 * Loads the config for a given environment from config.json in the current
 * working directory. Values can be overridden via environment variables:
 *   MIGRIS_DB_HOST, MIGRIS_DB_PORT, MIGRIS_DB_USER, MIGRIS_DB_PASSWORD, MIGRIS_DB_DATABASE
 */
export function loadConfig(environment: string): EnvironmentConfig {
  const configPath = path.join(process.cwd(), "config.json");

  if (!fs.existsSync(configPath)) {
    throw new MigrisError(
      `config.json not found in the current directory.\nRun "migris init" to create a template.`
    );
  }

  let parsed: MigrisConfig;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    parsed = JSON.parse(raw) as MigrisConfig;
  } catch {
    throw new MigrisError("config.json is not valid JSON.");
  }

  const envConfig = parsed.environments?.[environment];
  if (!envConfig) {
    const available = Object.keys(parsed.environments ?? {}).join(", ") || "none";
    throw new MigrisError(
      `Environment "${environment}" not found in config.json.\nAvailable environments: ${available}`
    );
  }

  return {
    host: process.env["MIGRIS_DB_HOST"] ?? envConfig.host,
    port: Number(process.env["MIGRIS_DB_PORT"] ?? envConfig.port),
    user: process.env["MIGRIS_DB_USER"] ?? envConfig.user,
    password: process.env["MIGRIS_DB_PASSWORD"] ?? envConfig.password,
    database: process.env["MIGRIS_DB_DATABASE"] ?? envConfig.database,
  };
}
