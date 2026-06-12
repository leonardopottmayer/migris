# migris

CLI tool for managing PostgreSQL database migrations using plain `.sql` files.

Each migration lives in a timestamped folder with an `up.sql` and a `down.sql` file. No ORM, no magic, just SQL.

migris scales from a single flat timeline up to a **modular, multi-tenant** project — and can **eject** any module or tenant into its own standalone project. All of that is **opt-in by structure**: a simple project stays simple, and everything you already had keeps working unchanged.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [config.json](#configjson)
  - [Environment Variable Overrides](#environment-variable-overrides)
- [Migration Structure](#migration-structure)
- [Project Modes](#project-modes)
- [Modules](#modules)
- [Versioned Objects](#versioned-objects)
  - [The `.meta.json` file](#the-metajson-file)
- [Multi-Tenant](#multi-tenant)
  - [Object overrides & suppression](#object-overrides--suppression)
  - [Fork drift](#fork-drift)
- [Eject](#eject)
- [Commands](#commands)
  - [migris init](#migris-init-env)
  - [migris create](#migris-create-name---module-m)
  - [migris create-object](#migris-create-object-object-name)
  - [migris apply](#migris-apply-env)
  - [migris rollback](#migris-rollback-env-migration_id)
  - [migris status](#migris-status-env)
  - [migris check](#migris-check-env)
  - [migris validate](#migris-validate---strict)
  - [migris drift](#migris-drift-env)
  - [migris environments](#migris-environments)
  - [migris eject](#migris-eject)
- [Global Flags](#global-flags)
- [Database Schema](#database-schema)
- [Exit Codes](#exit-codes)
- [CI/CD Integration](#cicd-integration)
- [Testing](#testing)
- [Development](#development)
- [License](#license)

---

## Installation

### From npm

```bash
npm install -g migris
```

### From source

```bash
git clone https://github.com/leonardopottmayer/migris
cd migris
npm install
npm run build
npm link
```

To unlink:

```bash
npm unlink -g migris
```

### Node.js version

For development, this repository uses Node `24.15.0` via `.nvmrc`.

For installing and running the published package, `migris` supports Node `24` and newer.

---

## Quick Start

```bash
# 1. Go to your project directory
cd my-project

# 2. Initialize: creates config.json template, migrations/ directory,
#    and the migrations table in your database
migris init dev

# 3. Edit config.json with your database credentials
# 4. Create your first migration
migris create create-users-table

# 5. Edit the generated up.sql and down.sql files
# 6. Apply
migris apply dev
```

---

## Configuration

### config.json

Create a `config.json` file in the directory where you run `migris` or `mg` commands. It must define at least one named environment:

```json
{
  "environments": {
    "dev": {
      "host": "localhost",
      "port": 5432,
      "user": "your_user",
      "password": "your_password",
      "database": "your_database"
    },
    "prod": {
      "host": "prod-db.example.com",
      "port": 5432,
      "user": "prod_user",
      "password": "prod_password",
      "database": "prod_database"
    }
  }
}
```

> **Note:** `config.json` should not be committed to version control. Add it to `.gitignore`.

### Environment Variable Overrides

Any value in `config.json` can be overridden with environment variables, which is useful in CI/CD pipelines where secrets should not be stored in files:

| Environment Variable | Overrides  |
|----------------------|------------|
| `MIGRIS_DB_HOST`     | `host`     |
| `MIGRIS_DB_PORT`     | `port`     |
| `MIGRIS_DB_USER`     | `user`     |
| `MIGRIS_DB_PASSWORD` | `password` |
| `MIGRIS_DB_DATABASE` | `database` |

Example:

```bash
MIGRIS_DB_PASSWORD=supersecret migris apply prod
```

---

## Migration Structure

```
migrations/
|-- 20250523120000-create-users-table/
|   |-- 20250523120000-create-users-table.up.sql
|   `-- 20250523120000-create-users-table.down.sql
`-- 20250523130000-add-orders-table/
    |-- 20250523130000-add-orders-table.up.sql
    `-- 20250523130000-add-orders-table.down.sql
```

- **Folder name:** `{YYYYMMDDHHmmss}-{migration-name}`
- **Files:** `{folder-name}.up.sql` and `{folder-name}.down.sql`
- Migrations are applied in **alphabetical order** (which is chronological given the timestamp prefix).
- Both `up.sql` and `down.sql` must be present. `migris apply` will refuse to run if any migration is incomplete.

---

## Project Modes

migris **detects the mode from your folder structure** — there is no flag to "enable modules". Modes combine freely (flat + tenants, modular + tenants, modular without tenants, etc.).

| Signal on disk | Mode |
|----------------|------|
| Migration folders **directly** inside `migrations/` | **Flat** (no modules) |
| `migrations/` contains **only module subfolders** (each holding migrations) | **Modular** (each subfolder is a module; the base is `default`) |
| A `tenants/` folder exists | **Multi-tenant** enabled |
| No `tenants/` folder | **Single-tenant** |

An empty project is flat. Passing `--module` on the very first `create` bootstraps a modular project.

Everything else in migris (apply, rollback, status, check, ids, the `migrations` table) is **unchanged** by the mode — a flat single-tenant project behaves exactly as it always did.

---

## Modules

In a modular project, each top-level folder under `migrations/` is a **module** (typically one schema):

```
pandora/
├─ migrations/
│  ├─ default/          ← extensions, global functions — ALWAYS included
│  │  └─ 20260131152820-create-extension-pgcrypto/...
│  ├─ identity/
│  │  └─ 20260131153000-create-schema-identity/...
│  └─ notifications/
│     └─ 20260604120000-create-schema-notifications/...
└─ objects/
   ├─ default/  identity/  notifications/
```

- **`default` is special:** it is the base/catch-all (extensions, global helpers) and is **always included** in every apply, eject and tenant.
- **`migration_id` is still the leaf folder name** (e.g. `20260604120000-create-schema-notifications`). The module folder is **not** part of the id, so moving a migration between modules does not change its id — already-applied databases don't notice. Ids must be **globally unique** across all modules and overlays.
- **Ordering is global:** migris merge-sorts every migration by its 14-digit timestamp regardless of module. The folder is only a selection label; it never changes execution order.
- **Boundary validation:** a migration inside module `M` should only reference its own schema or `default`. Referencing another module's schema is flagged (see [`migris validate`](#migris-validate---strict)). This is what keeps modules cleanly [ejectable](#eject).

---

## Versioned Objects

Database objects that are **idempotent via `CREATE OR REPLACE`** — `FUNCTION`, `PROCEDURE`, `VIEW`, and (PG14+) `TRIGGER` — can live as a **single source-of-truth file** under `objects/`. The file gives you the **current state** (just open it) and the **history** (`git log` of that one file).

> Structural/stateful objects (`TABLE`, `TYPE`/`ENUM`, `MATERIALIZED VIEW`, indexes, constraints) are **not** replaceable and stay as ordinary versioned migrations.

An object's **identity** is its path relative to `objects/`, without `.sql`:

| Mode | File | Identity |
|------|------|----------|
| Flat | `objects/views/v-active-users.sql` | `views/v-active-users` |
| Modular | `objects/notifications/views/v-not-pending.sql` | `notifications/views/v-not-pending` |

You edit the object file, then run [`migris create-object`](#migris-create-object-object-name) to **compile** it into an ordinary migration. The flow is always **object → migration**:

| Migration | `up.sql` | `down.sql` |
|-----------|----------|------------|
| v1 | `CREATE OR REPLACE` → **v1** | **you write it** (usually a `DROP`) |
| v2 | `CREATE OR REPLACE` → **v2** | `CREATE OR REPLACE` → v1 *(generated)* |
| v3 | `CREATE OR REPLACE` → **v3** | `CREATE OR REPLACE` → v2 *(generated)* |

From v2 on, the previous version's `up.sql` becomes the new `down.sql` **for free** — migris never parses the object's SQL. The generated migration is then a completely ordinary one (same apply, rollback, checksum, batch).

Generation is **100% offline** — `create-object` never connects to a database.

### The `.meta.json` file

Object-migrations carry a sibling `{id}.meta.json` (ordinary migrations never have one):

```json
{
  "object": "notifications/views/v-not-pending",
  "sourceChecksum": "9f2a…",
  "forkedFrom": "20260611100000-add-pending-view"
}
```

| Field | Meaning |
|-------|---------|
| `object` | The object identity — **this is the migration ↔ object link**. |
| `sourceChecksum` | SHA-256 of the object file at generation time (drift detection). |
| `forkedFrom` | **Tenant overrides only.** The `migration_id` of the common version this fork is based on (see [fork drift](#fork-drift)). Absent on common objects. |

The `migrations` **table is unchanged** — no new columns. The object link, `forkedFrom`, and override suppression all live on disk.

---

## Multi-Tenant

When a `tenants/` folder exists, each environment can have an **overlay** that mirrors the root structure and holds only its **delta**. The common root is applied to everyone; the overlay adds the tenant-specific bits. **The environment name *is* the tenant name** — for environment `E`, migris looks for `tenants/E/`:

- `migris apply homolog` → no `tenants/homolog/` → applies **only the common** timeline.
- `migris apply acme` → `tenants/acme/` exists → applies **common + acme overlay**.

```
pandora/
├─ migrations/            ← COMMON (applied to all tenants)
├─ objects/               ← COMMON
└─ tenants/
   └─ acme/
      ├─ migrations/notifications/20260610-...-add-sla/   ← additive delta
      └─ objects/notifications/views/v-not-pending.sql    ← object OVERRIDE
```

### Object overrides & suppression

There are two ways a tenant can diverge:

| Form | Versioned migration | Object |
|------|---------------------|--------|
| **Additive** (overlay adds something new) | ✅ | ✅ |
| **Override** (shadow a common object) | ❌ not allowed | ✅ allowed |

Override is only for **objects**. When a tenant overrides an object (via `create-object … --tenant <env>`), migris **suppresses the common object-migrations of that object** for that tenant — the tenant **owns the object's lineage** from that point (its first override `down` is therefore a `DROP`). Structural divergence per tenant is always **additive** — you never rewrite history per tenant.

### Fork drift

- Object **not** overridden → the tenant gets common improvements **automatically** (the common migration runs everywhere).
- Object **overridden** (forked) → updates are **not** automatic. migris tracks an explicit `forkedFrom` pointer and **warns** when the fork falls behind, showing the **upstream diff** so you can reconcile by hand.

The pointer is only advanced by an explicit **reconcile**:

```bash
migris create-object notifications/views/v-not-pending --tenant acme --rebase
```

`--rebase` regenerates the override **and** advances `forkedFrom` to the current common version — clearing the alert. Regenerating the override for any *other* reason never clears it (no silent drift). Use [`migris drift`](#migris-drift-env) to see the radar.

---

## Eject

Eject extracts a slice of the project into a **standalone migris**. There are two orthogonal axes (and the cell where they meet):

| Eject | Slice | Produces |
|-------|-------|----------|
| **Module** (`--module`, vertical) | one module + `default` | a service (e.g. a notifications microservice) |
| **Tenant** (`--tenant`, horizontal) | one tenant's fully-resolved row | a dedicated single-tenant deployment of that client |
| **Cell** (`--module` + `--tenant`) | a module in a tenant's variant | a service already in the client's variant |

```bash
migris eject --module notifications --out ../notif-service     # vertical
migris eject --tenant  acme         --out ../acme-standalone    # horizontal
migris eject --module notifications --tenant acme --out ...     # cell
migris eject notifications --out ../notif-service               # sugar for --module
```

- **Module eject** keeps the module's **schema** intact (no SQL rewrite), drags `default` along, and emits a **template** `config.json` for the new service DB.
- **Tenant eject** resolves the overlay over the whole base into a single-tenant project, **preserving every `migration_id`**. Because the ids are identical, the ejected project **recognizes the tenant's existing database** — `migris check prod` reports everything applied, so you get a **cutover with no downtime**. Overridden objects are written as canonical objects (the `tenants/` concept disappears); a `config.json` is emitted pointing at the tenant's DB (password blanked). It runs a [drift](#migris-drift-env) pre-check and **warns** if you'd be freezing divergent state.
- **`--squash`** (optional, advanced) collapses everything into a single baseline migration. Only sound for a **brand-new** database — it breaks the cutover against an existing one.

> Eject is a **copy, not a change** — it does not remove the module/overlay from the monolith. After ejecting, the repos diverge.

---

## Commands

### `migris init [env]`

Initializes the project in the current directory.

```bash
migris init     # creates config.json template + migrations/ directory
mg init dev     # same command using the short alias
```

**What it does:**
- Creates `config.json` with a template (skips if it already exists)
- Creates the `migrations/` directory (skips if it already exists)
- When `env` is provided: connects to the database and runs `CREATE TABLE IF NOT EXISTS migrations (...)`, including a safe `ALTER TABLE` to add the `checksum` column to any pre-existing table

---

### `migris create <name> [--module <m>]`

Creates a new migration folder with empty `up.sql` and `down.sql` files.

```bash
migris create create-users-table
migris create add-email-column
migris create create-schema-identity --module identity   # modular project
```

**Name validation:**
- Must be **lowercase kebab-case** only
- Allowed characters: `a-z`, `0-9`, `-`
- Cannot start or end with a hyphen
- Cannot contain consecutive hyphens, spaces, underscores, or uppercase letters

Valid examples: `create-users`, `add-column-v2`, `init`

Invalid examples: `CreateUsers`, `create_users`, `create users`, `-start`, `end-`

**`--module <m>`** (see [Modules](#modules)):
- In a **modular** project, `--module` is **required**.
- In an established **flat** project, `--module` is **rejected**.
- In an **empty** project, passing `--module` bootstraps a modular layout.

The generated `migration_id` (timestamp + name) must be **globally unique** across all modules and tenant overlays.

**Generated structure (modular):**

```
migrations/
`-- identity/
    `-- 20250523120000-create-schema-identity/
        |-- 20250523120000-create-schema-identity.up.sql
        `-- 20250523120000-create-schema-identity.down.sql
```

---

### `migris create-object <object> [name]`

Compiles an [object](#versioned-objects) source file into a migration. **Offline — never touches the database.**

```bash
# Edit objects/notifications/views/v-not-pending.sql first, then:
migris create-object notifications/views/v-not-pending add-pending-view
```

- `<object>` is the object identity (its path under `objects/` without `.sql`). The destination module is derived from it.
- **v1** (no prior version): `up` is a literal copy of the source; `down` is a **placeholder you fill in** (usually a `DROP`).
- **v2+**: `up` is the new version; `down` is the **previous version's `up`**, generated automatically.

**Options:**

| Flag | Description |
|------|-------------|
| `--amend` | Rewrite the object's **most recent** migration in place (a draft loop), instead of creating a new version. Omit the `name`. |
| `--tenant <env>` | Compile from the tenant overlay (`tenants/<env>/objects/...`) as an **override**. Writes `forkedFrom` in the `.meta.json`. |
| `--rebase` | Reconcile a tenant override: regenerate it **and advance** `forkedFrom` to the current common version (clears the [drift](#fork-drift) alert). Use with `--tenant`; omit the `name`. |
| `--dry-run` | Print the `up`/`down`/`meta` that would be generated, without writing anything. |

**Typical dev loop:**

```bash
# edit the object
migris create-object notifications/procedures/sp-enqueue tune-enqueue
migris apply local                # a compile error shows up in YOUR terminal

# fix the object, then overwrite the draft in place
migris create-object notifications/procedures/sp-enqueue --amend
migris apply local                # reapply
```

---

### `migris apply <env>`

Applies all pending migrations for the given environment.

```bash
migris apply dev
mg apply prod --dry-run
migris apply dev -y
```

**Options:**

| Flag        | Description |
|-------------|-------------|
| `--dry-run` | Preview which migrations would be applied without executing them |
| `-y, --yes` | Skip the confirmation prompt |

**How it works:**
1. Validates that every migration folder has both `up.sql` and `down.sql`; aborts if any are incomplete
2. Connects to the database and finds all migrations not yet in the `migrations` table with status `A`
3. Shows a confirmation prompt (skipped with `-y` or in non-interactive/CI environments)
4. Applies each pending migration inside a **transaction**. If one fails, it rolls back the transaction and marks the migration as `E` (error), then stops
5. Records a **SHA-256 checksum** of each `up.sql` so that modifications to already-applied migrations can be detected
6. Groups applied migrations under the same `batch` number for easy rollback

**Checksum detection:**

If you modify a `up.sql` file after it has already been applied, `migris apply` will warn you:

```
Warning: checksum mismatch on already-applied migration: 20250523120000-create-users-table
```

---

### `migris rollback <env> [migration_id]`

Rolls back the last applied batch, or all batches from a specific migration onward.

```bash
migris rollback dev                              # rolls back the last batch
migris rollback dev 20250523120000-create-users  # rolls back this migration's batch and all after it
mg rollback prod --dry-run
migris rollback dev -y
```

**Options:**

| Flag        | Description |
|-------------|-------------|
| `--dry-run` | Preview which migrations would be rolled back without executing them |
| `-y, --yes` | Skip the confirmation prompt |

**How it works:**
1. Without `migration_id`: finds the highest `application_batch_id` and rolls back all migrations in that batch
2. With `migration_id`: finds that migration's batch, then rolls back it and every subsequent batch
3. Migrations are rolled back in **reverse order** (newest first)
4. Each `down.sql` runs inside a **transaction**. On failure, it rolls back and marks as `E`, then stops

---

### `migris status <env>`

Shows the migration history grouped by batch.

```bash
migris status dev
mg status dev --limit 10
migris status dev --all
migris status dev --json
```

**Options:**

| Flag          | Description |
|---------------|-------------|
| `--limit <n>` | Number of recent batches to show (default: 5) |
| `--all`       | Show all batches (overrides `--limit`) |

**Output example:**

```
Last 2 batch(es) - environment: dev

  Batch #2:
    [OK] 20250523130000-add-orders-table       2025-05-23 13:00:05
    [OK] 20250523140000-add-indexes            2025-05-23 14:01:12

  Batch #1:
    [RB] 20250523120000-create-users-table     2025-05-23 12:05:33
```

**Status symbols:**

| Symbol | Status code | Meaning |
|--------|-------------|---------|
| `[OK]` | `A`         | Applied |
| `[RB]` | `R`         | Rolled back |
| `[!]`  | `E`         | Error/Failed |
| `[?]`  | other       | Unknown |

---

### `migris check <env>`

Checks whether all migrations on disk have been applied in the database.
Designed for use in CI pipelines.

```bash
migris check dev
mg check prod --json
```

**Exit codes:**
- `0` - all migrations are applied (up to date)
- `2` - there are pending migrations

**Example CI usage:**

```yaml
- name: Check for unapplied migrations
  run: migris check prod
  # exits 2 and fails the pipeline if there are pending migrations
```

`check` also surfaces [boundary](#modules) warnings before connecting.

---

### `migris validate [--strict]`

Checks [module boundaries](#modules): flags any migration in module `M` that references another module's schema (references to `default` are always allowed). It also warns about **orphan overlays** — a `tenants/<env>/` folder with no matching environment in `config.json`. **Offline.**

```bash
migris validate            # reports violations as warnings
migris validate --strict   # exits non-zero on any boundary violation (CI gate)
migris validate --json
```

It is a best-effort heuristic (comments and string literals are ignored) — the goal is to catch accidental coupling, not to be a full SQL parser.

---

### `migris drift <env>`

Lists overridden objects in a tenant that have fallen **behind** the common version (the fork radar), with the upstream diff to reconcile. **Offline.**

```bash
migris drift acme
migris drift acme --strict   # exits non-zero if any fork is behind (CI gate)
migris drift acme --json
```

The alert only clears when you run `create-object … --tenant acme --rebase`. See [Fork drift](#fork-drift).

---

### `migris environments`

Lists the environments declared in `config.json`. **Offline.** With `--json` it feeds a dynamic CI matrix.

```bash
migris environments
migris environments --json
```

```json
[
  { "name": "acme", "tenant": true, "database": "pandora_acme" },
  { "name": "homolog", "tenant": false, "database": "pandora_homolog" }
]
```

---

### `migris eject`

Extracts a module and/or a tenant into a standalone migris project. **Offline.** See [Eject](#eject) for the full model.

```bash
migris eject --module notifications --out ../notif-service
migris eject --tenant  acme         --out ../acme-standalone
migris eject --module notifications --tenant acme --out ../acme-notif
migris eject notifications --out ../notif-service     # positional sugar for --module
```

**Options:**

| Flag | Description |
|------|-------------|
| `--module <m>` | Eject a module + `default` (vertical). |
| `--tenant <env>` | Eject a fully-resolved tenant (horizontal, cutover-friendly). |
| `--out <path>` | Destination directory (required). |
| `--squash` | Collapse the selection into a single baseline migration (new DB only). |

---

## Global Flags

These flags work with any command:

| Flag     | Description |
|----------|-------------|
| `--json` | Output results as JSON instead of human-readable text. Useful for scripts and CI. |

**JSON output example for `migris status dev --json`:**

```json
[
  {
    "batch": 1,
    "migrations": [
      {
        "migration_id": "20250523120000-create-users-table",
        "status": "A",
        "updated_at": "2025-05-23T12:00:05.000Z"
      }
    ]
  }
]
```

**JSON output example for `migris check dev --json`:**

```json
{
  "pending_count": 1,
  "pending": ["20250523130000-add-orders-table"]
}
```

---

## Database Schema

The `migrations` table is created automatically by `migris init <env>`:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  migration_id         VARCHAR(255) PRIMARY KEY,
  status               CHAR(1)     NOT NULL,
  updated_at           TIMESTAMP,
  application_batch_id INTEGER,
  checksum             VARCHAR(64)
);
```

| Column                 | Description |
|------------------------|-------------|
| `migration_id`         | The migration folder name (for example `20250523120000-create-users-table`) |
| `status`               | `A` = applied, `R` = rolled back, `E` = error |
| `updated_at`           | Timestamp of the last status change |
| `application_batch_id` | Batch number. All migrations applied together share the same batch |
| `checksum`             | SHA-256 hash of the `up.sql` content at apply time |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | Error (connection failure, invalid config, SQL error, etc.) |
| `2`  | Pending migrations exist (`migris check` only) |

---

## CI/CD Integration

### Applying migrations in a pipeline

```yaml
- name: Run database migrations
  env:
    MIGRIS_DB_HOST: ${{ secrets.DB_HOST }}
    MIGRIS_DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
  run: migris apply prod --yes
```

### Detecting unapplied migrations (block deploy if migrations are missing)

```yaml
- name: Verify all migrations applied
  run: |
    migris check prod --json
    if [ $? -eq 2 ]; then
      echo "Pending migrations detected. Deploy blocked."
      exit 1
    fi
```

### Notes for CI environments

- **No TTY prompts:** confirmation prompts are automatically skipped when stdin is not a TTY (for example in GitHub Actions). Use `-y` explicitly if needed.
- **ENV var overrides:** use `MIGRIS_DB_*` environment variables instead of committing `config.json` with credentials to your repository.
- **`--json` flag:** pipe structured output to other tools (`jq`, scripts, Slack notifications, etc.).

---

## Testing

The project uses [Vitest](https://vitest.dev/) for testing.

```bash
npm test
npm run test:watch
```

**Test coverage:**

| File | What is tested |
|------|----------------|
| `errors.test.ts` | `MigrisError` class, message handling, exit codes |
| `logger.test.ts` | Plain and JSON output modes, stdout vs stderr routing |
| `checksum.test.ts` | SHA-256 correctness, determinism, sensitivity to changes |
| `config.test.ts` | Config loading, error cases, ENV var overrides for all 5 fields |
| `prompt.test.ts` | Auto-approval in non-TTY environments |
| `create.test.ts` | Name validation, file/directory creation, output |
| `init.test.ts` | File creation, idempotency, config template shape |
| `apply.test.ts` | Dry-run, transaction calls, error handling, alphabetical order |
| `rollback.test.ts` | Dry-run, transaction calls, error handling, `targetMigrationId` |
| `status.test.ts` | Status symbols, batch display, `--limit`, `--all`, JSON output |
| `check.test.ts` | Pending detection, exit codes, JSON output |
| `discovery.test.ts` | Mode detection, recursive discovery, merge-sort, overlay & suppression |
| `create-object.test.ts` | v1 placeholder / v2+ auto-down, `--amend`, `--dry-run`, `.meta.json`, `forkedFrom` |
| `drift.test.ts` | Behind detection, upstream diff, `--rebase` advances pointer, no silent clear |
| `tenants.test.ts` | Common-only vs common+overlay apply, override suppression |
| `boundary.test.ts` | Cross-module detection, `default` allowed, `--strict` fails |
| `eject.test.ts` | Module copy + ids, tenant resolution + cutover ids, drift warning, squash |

---

## Development

```bash
nvm use
npm install
npm run build
npm test
npm run test:watch
npm link
```

**Project structure:**

```
src/
|-- index.ts              # CLI entry point (Commander)
|-- errors.ts             # MigrisError with exit codes
|-- logger.ts             # log.info/success/warn/error + JSON mode
|-- checksum.ts           # SHA-256 for migration files
|-- prompt.ts             # interactive confirmation
|-- config.ts             # config.json loader + ENV var overrides
|-- db.ts                 # PostgreSQL client factory
|-- discovery.ts          # migration discovery, modes, effective list + suppression
|-- objects.ts            # object identity & destination helpers
|-- boundary.ts           # cross-module boundary scan
|-- eject.ts              # file-copy / config / squash helpers
`-- commands/
    |-- init.ts           # migris init
    |-- create.ts         # migris create (+ --module)
    |-- create-object.ts  # migris create-object (+ --amend/--tenant/--rebase/--dry-run)
    |-- apply.ts          # migris apply
    |-- rollback.ts       # migris rollback
    |-- status.ts         # migris status
    |-- check.ts          # migris check
    |-- validate.ts       # migris validate
    |-- drift.ts          # migris drift
    |-- environments.ts   # migris environments
    `-- eject.ts          # migris eject

tests/
|-- helpers/fixtures.ts   # temp-dir project builders
|-- errors.test.ts        logger.test.ts        checksum.test.ts
|-- config.test.ts        prompt.test.ts        init.test.ts
|-- create.test.ts        apply.test.ts         rollback.test.ts
|-- status.test.ts        check.test.ts
|-- discovery.test.ts     create-object.test.ts drift.test.ts
|-- tenants.test.ts       boundary.test.ts      eject.test.ts

.github/
`-- workflows/
    `-- ci.yml            # CI: build + test on Node 24 + publish dry-run
```

---

## License

ISC
