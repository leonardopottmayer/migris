import { Client } from "pg";
import { loadConfig } from "./config";

/**
 * Creates and connects a PostgreSQL client for the given environment.
 * Throws MigrisError if config is missing or connection fails.
 */
export async function createConnectedClient(environment: string): Promise<Client> {
  const config = loadConfig(environment);

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    application_name: `migris-cli-${environment}`,
  });

  await client.connect();
  return client;
}
