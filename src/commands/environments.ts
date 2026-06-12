import { isJsonMode } from "../logger";
import { loadRawConfig } from "../config";
import { hasTenant } from "../discovery";

/**
 * Lists the environments declared in config.json (§13.2). With --json it emits a
 * machine-readable list to drive a dynamic CI matrix. Offline.
 */
export function environments(): void {
  const { environments: envs } = loadRawConfig();
  const names = Object.keys(envs);

  const items = names.map((name) => ({
    name,
    tenant: hasTenant(process.cwd(), name),
    database: envs[name].database,
  }));

  if (isJsonMode()) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }

  if (names.length === 0) {
    process.stdout.write("No environments defined in config.json.\n");
    return;
  }

  process.stdout.write("\nEnvironments:\n");
  for (const item of items) {
    const tag = item.tenant ? " [tenant overlay]" : "";
    process.stdout.write(`  - ${item.name} → ${item.database}${tag}\n`);
  }
  process.stdout.write("\n");
}
