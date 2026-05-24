import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { rollbackMigrations } from "../src/commands/rollback";
import { MigrisError } from "../src/errors";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migris-rollback-test-"));
}

function createFakeMigration(migrationsDir: string, name: string, downSql = "SELECT 0;") {
  const dir = path.join(migrationsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.up.sql`), "SELECT 1;");
  fs.writeFileSync(path.join(dir, `${name}.down.sql`), downSql);
}

describe("rollbackMigrations", () => {
  let tmpDir: string;
  let migrationsDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    migrationsDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migrationsDir);
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function makeConnectSpy(migrationRows: { migration_id: string }[] = [], batchId: number | null = 1) {
    const dbModule = await import("../src/db");
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("MAX(application_batch_id)"))
          return Promise.resolve({ rows: [{ application_batch_id: batchId }] });
        if (sql.includes("SELECT application_batch_id FROM migrations WHERE migration_id"))
          return Promise.resolve({ rows: batchId ? [{ application_batch_id: batchId }] : [] });
        if (sql.includes("SELECT migration_id FROM migrations"))
          return Promise.resolve({ rows: migrationRows });
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
          return Promise.resolve({});
        if (sql.includes("UPDATE migrations"))
          return Promise.resolve({});
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);
    return { spy, mockClient };
  }

  it("logs 'No applied migrations' when there are none to roll back", async () => {
    const { spy } = await makeConnectSpy([], null);

    await rollbackMigrations("dev", undefined, { yes: true });

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No applied");
    spy.mockRestore();
  });

  it("calls BEGIN and COMMIT when rolling back", async () => {
    createFakeMigration(migrationsDir, "20250101000000-users");
    const { spy, mockClient } = await makeConnectSpy([{ migration_id: "20250101000000-users" }]);

    await rollbackMigrations("dev", undefined, { yes: true });

    const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls).toContain("COMMIT");
    spy.mockRestore();
  });

  it("throws MigrisError when down.sql is missing", async () => {
    const dir = path.join(migrationsDir, "20250101000000-users");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "20250101000000-users.up.sql"), "SELECT 1;");

    const { spy } = await makeConnectSpy([{ migration_id: "20250101000000-users" }]);

    await expect(rollbackMigrations("dev", undefined, { yes: true })).rejects.toThrow(MigrisError);
    spy.mockRestore();
  });

  it("calls ROLLBACK and marks status E when down.sql execution fails", async () => {
    createFakeMigration(migrationsDir, "20250101000000-bad", "INVALID SQL!!!");

    const dbModule = await import("../src/db");
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("MAX(application_batch_id)"))
          return Promise.resolve({ rows: [{ application_batch_id: 1 }] });
        if (sql.includes("SELECT migration_id FROM migrations"))
          return Promise.resolve({ rows: [{ migration_id: "20250101000000-bad" }] });
        if (sql === "BEGIN") return Promise.resolve({});
        if (sql === "ROLLBACK") return Promise.resolve({});
        if (sql.includes("UPDATE migrations")) return Promise.resolve({});
        if (sql === "INVALID SQL!!!") return Promise.reject(new Error("syntax error"));
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);

    await expect(rollbackMigrations("dev", undefined, { yes: true })).rejects.toThrow(MigrisError);

    const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls).toContain("ROLLBACK");
    const updateError = sqlCalls.find((s) => s.includes("UPDATE migrations") && s.includes("'E'"));
    expect(updateError).toBeTruthy();
    spy.mockRestore();
  });

  describe("--dry-run", () => {
    it("does not call BEGIN in dry-run mode", async () => {
      createFakeMigration(migrationsDir, "20250101000000-users");
      const { spy, mockClient } = await makeConnectSpy([{ migration_id: "20250101000000-users" }]);

      await rollbackMigrations("dev", undefined, { dryRun: true, yes: true });

      const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
      expect(sqlCalls).not.toContain("BEGIN");
      spy.mockRestore();
    });

    it("prints the list of migrations to roll back in dry-run", async () => {
      createFakeMigration(migrationsDir, "20250101000000-users");
      const { spy } = await makeConnectSpy([{ migration_id: "20250101000000-users" }]);

      await rollbackMigrations("dev", undefined, { dryRun: true, yes: true });

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("20250101000000-users");
      expect(output).toContain("Dry run");
      spy.mockRestore();
    });
  });

  describe("targetMigrationId", () => {
    it("queries the specific migration's batch when targetMigrationId is given", async () => {
      createFakeMigration(migrationsDir, "20250101000000-users");
      const { spy, mockClient } = await makeConnectSpy([{ migration_id: "20250101000000-users" }]);

      await rollbackMigrations("dev", "20250101000000-users", { yes: true });

      const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
      const lookupCall = sqlCalls.find((s) => s.includes("SELECT application_batch_id") && s.includes("migration_id = $1"));
      expect(lookupCall).toBeTruthy();
      spy.mockRestore();
    });

    it("throws MigrisError when targetMigrationId does not exist", async () => {
      const dbModule = await import("../src/db");
      const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("SELECT application_batch_id FROM migrations WHERE migration_id"))
            return Promise.resolve({ rows: [] });
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);

      await expect(
        rollbackMigrations("dev", "nonexistent-migration", { yes: true })
      ).rejects.toThrow(MigrisError);
      spy.mockRestore();
    });
  });
});
