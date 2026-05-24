# migris

CLI tool for managing PostgreSQL database migrations using plain `.sql` files.

Each migration lives in a timestamped folder with an `up.sql` and a `down.sql` — no ORM, no magic, just SQL.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [config.json](#configjson)
  - [Environment Variable Overrides](#environment-variable-overrides)
- [Migration Structure](#migration-structure)
- [Commands](#commands)
  - [migris init](#migris-init-env)
  - [migris create](#migris-create-name)
  - [migris apply](#migris-apply-env)
  - [migris rollback](#migris-rollback-env-migration_id)
  - [migris status](#migris-status-env)
  - [migris check](#migris-check-env)
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
git clone https://github.com/leonardopottmayer/pottmayer-migris
cd pottmayer-migris
npm install
npm run build
npm link
```

To unlink:

```bash
npm unlink -g migris
```

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

Any value in `config.json` can be overridden with environment variables — useful in CI/CD pipelines where secrets should not be stored in files:

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
├── 20250523120000-create-users-table/
│   ├── 20250523120000-create-users-table.up.sql
│   └── 20250523120000-create-users-table.down.sql
├── 20250523130000-add-orders-table/
│   ├── 20250523130000-add-orders-table.up.sql
│   └── 20250523130000-add-orders-table.down.sql
```

- **Folder name:** `{YYYYMMDDHHmmss}-{migration-name}`
- **Files:** `{folder-name}.up.sql` and `{folder-name}.down.sql`
- Migrations are applied in **alphabetical order** (which is chronological given the timestamp prefix).
- Both `up.sql` and `down.sql` must be present — `migris apply` will refuse to run if any migration is incomplete.

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

### `migris create <name>`

Creates a new migration folder with empty `up.sql` and `down.sql` files.

```bash
migris create create-users-table
migris create add-email-column
mg create drop-legacy-indexes
```

**Name validation:**
- Must be **lowercase kebab-case** only
- Allowed characters: `a-z`, `0-9`, `-`
- Cannot start or end with a hyphen
- Cannot contain consecutive hyphens, spaces, underscores, or uppercase letters

Valid examples: `create-users`, `add-column-v2`, `init`

Invalid examples: `CreateUsers`, `create_users`, `create users`, `-start`, `end-`

**Generated structure:**

```
migrations/
└── 20250523120000-create-users-table/
    ├── 20250523120000-create-users-table.up.sql
    └── 20250523120000-create-users-table.down.sql
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

| Flag        | Description                                          |
|-------------|------------------------------------------------------|
| `--dry-run` | Preview which migrations would be applied without executing them |
| `-y, --yes` | Skip the confirmation prompt                         |

**How it works:**
1. Validates that every migration folder has both `up.sql` and `down.sql` — aborts if any are incomplete
2. Connects to the database and finds all migrations not yet in the `migrations` table with status `A`
3. Shows a confirmation prompt (skipped with `-y` or in non-interactive/CI environments)
4. Applies each pending migration inside a **transaction** — if one fails, it rolls back the transaction and marks the migration as `E` (error), then stops
5. Records a **SHA-256 checksum** of each `up.sql` so that modifications to already-applied migrations can be detected
6. Groups applied migrations under the same `batch` number for easy rollback

**Checksum detection:**

If you modify a `up.sql` file after it has already been applied, `migris apply` will warn you:

```
⚠️  Checksum mismatch on already-applied migration: 20250523120000-create-users-table
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

| Flag        | Description                                           |
|-------------|-------------------------------------------------------|
| `--dry-run` | Preview which migrations would be rolled back without executing them |
| `-y, --yes` | Skip the confirmation prompt                          |

**How it works:**
1. Without `migration_id`: finds the highest `application_batch_id` and rolls back all migrations in that batch
2. With `migration_id`: finds that migration's batch, then rolls back it and every subsequent batch
3. Migrations are rolled back in **reverse order** (newest first)
4. Each `down.sql` runs inside a **transaction** — on failure, rolls back and marks as `E`, then stops

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

| Flag          | Description                                    |
|---------------|------------------------------------------------|
| `--limit <n>` | Number of recent batches to show (default: 5)  |
| `--all`       | Show all batches (overrides `--limit`)         |

**Output example:**

```
📋 Last 2 batch(es) — environment: dev

  Batch #2:
    [✓] 20250523130000-add-orders-table       2025-05-23 13:00:05
    [✓] 20250523140000-add-indexes            2025-05-23 14:01:12

  Batch #1:
    [↩] 20250523120000-create-users-table     2025-05-23 12:05:33
```

**Status symbols:**

| Symbol | Status code | Meaning      |
|--------|-------------|--------------|
| `[✓]`  | `A`         | Applied      |
| `[↩]`  | `R`         | Rolled back  |
| `[!]`  | `E`         | Error/Failed |
| `[?]`  | other       | Unknown      |

---

### `migris check <env>`

Checks whether all migrations on disk have been applied in the database.
Designed for use in CI pipelines.

```bash
migris check dev
mg check prod --json
```

**Exit codes:**
- `0` — all migrations are applied (up to date)
- `2` — there are pending migrations

**Example CI usage:**

```yaml
- name: Check for unapplied migrations
  run: migris check prod
  # exits 2 and fails the pipeline if there are pending migrations
```

---

## Global Flags

These flags work with any command:

| Flag     | Description                                                        |
|----------|--------------------------------------------------------------------|
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

| Column                 | Description                                                  |
|------------------------|--------------------------------------------------------------|
| `migration_id`         | The migration folder name (e.g. `20250523120000-create-users-table`) |
| `status`               | `A` = applied, `R` = rolled back, `E` = error               |
| `updated_at`           | Timestamp of the last status change                          |
| `application_batch_id` | Batch number — all migrations applied together share the same batch |
| `checksum`             | SHA-256 hash of the `up.sql` content at apply time           |

---

## Exit Codes

| Code | Meaning                                         |
|------|-------------------------------------------------|
| `0`  | Success                                         |
| `1`  | Error (connection failure, invalid config, SQL error, etc.) |
| `2`  | Pending migrations exist (`migris check` only)  |

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

- **No TTY prompts:** confirmation prompts are automatically skipped when stdin is not a TTY (e.g. in GitHub Actions). Use `-y` explicitly if needed.
- **ENV var overrides:** use `MIGRIS_DB_*` environment variables instead of committing `config.json` with credentials to your repository.
- **`--json` flag:** pipe structured output to other tools (`jq`, scripts, Slack notifications, etc.).

---

## Testing

The project uses [Vitest](https://vitest.dev/) for testing.

```bash
npm test          # run all tests once
npm run test:watch  # watch mode
```

**Test coverage:**

| File | What is tested |
|------|----------------|
| `errors.test.ts` | `MigrisError` class — name, message, exit codes |
| `logger.test.ts` | Plain and JSON output modes, stdout vs stderr routing |
| `checksum.test.ts` | SHA-256 correctness, determinism, sensitivity to changes |
| `config.test.ts` | Config loading, error cases, ENV var overrides for all 5 fields |
| `prompt.test.ts` | Auto-approval in non-TTY environments |
| `create.test.ts` | Name validation (22 cases), file/directory creation, output |
| `init.test.ts` | File creation, idempotency, config template shape |
| `apply.test.ts` | Dry-run, transaction calls, error handling, alphabetical order |
| `rollback.test.ts` | Dry-run, transaction calls, error handling, `targetMigrationId` |
| `status.test.ts` | Status symbols, batch display, `--limit`, `--all`, JSON output |
| `check.test.ts` | Pending detection, exit codes, JSON output |

---

## Development

```bash
npm run build       # compile TypeScript → dist/
npm test            # run tests
npm run test:watch  # tests in watch mode
npm link            # install migris and mg globally from local source
```

**Project structure:**

```
src/
├── index.ts              # CLI entry point (Commander)
├── errors.ts             # MigrisError with exit codes
├── logger.ts             # log.info/success/warn/error + JSON mode
├── checksum.ts           # SHA-256 for migration files
├── prompt.ts             # interactive confirmation
├── config.ts             # config.json loader + ENV var overrides
├── db.ts                 # PostgreSQL client factory
└── commands/
    ├── init.ts           # migris init / mg init
    ├── create.ts         # migris create / mg create
    ├── apply.ts          # migris apply / mg apply
    ├── rollback.ts       # migris rollback / mg rollback
    ├── status.ts         # migris status / mg status
    └── check.ts          # migris check / mg check

tests/
├── errors.test.ts
├── logger.test.ts
├── checksum.test.ts
├── config.test.ts
├── prompt.test.ts
├── create.test.ts
├── init.test.ts
├── apply.test.ts
├── rollback.test.ts
├── status.test.ts
└── check.test.ts

.github/
└── workflows/
    └── ci.yml            # CI: build + test on Node 18/20/22 + publish dry-run
```

---

## License

ISC — Developed by Leonardo Gian Pottmayer
