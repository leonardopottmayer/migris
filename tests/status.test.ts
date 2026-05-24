import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showMigrationStatus } from "../src/commands/status";
import { setJsonMode } from "../src/logger";

describe("showMigrationStatus", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setJsonMode(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    setJsonMode(false);
  });

  async function makeConnectSpy(rows: object[], batchIds: number[]) {
    const dbModule = await import("../src/db");
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("SELECT DISTINCT application_batch_id"))
          return Promise.resolve({ rows: batchIds.map((id) => ({ application_batch_id: id })) });
        if (sql.includes("SELECT migration_id"))
          return Promise.resolve({ rows, rowCount: rows.length });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);
    return { spy, mockClient };
  }

  it("logs 'No migrations' when there are no batches", async () => {
    const { spy } = await makeConnectSpy([], []);

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("No migrations");
    spy.mockRestore();
  });

  it("displays batch number in output", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-users", status: "A", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Batch #1");
    spy.mockRestore();
  });

  it("shows ✓ symbol for applied migrations (status A)", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-users", status: "A", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("[✓]");
    spy.mockRestore();
  });

  it("shows ↩ symbol for rolled-back migrations (status R)", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-users", status: "R", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("[↩]");
    spy.mockRestore();
  });

  it("shows ! symbol for failed migrations (status E)", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-users", status: "E", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("[!]");
    spy.mockRestore();
  });

  it("shows ? symbol for unknown status", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-users", status: "X", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("[?]");
    spy.mockRestore();
  });

  it("displays migration_id in output", async () => {
    const { spy } = await makeConnectSpy(
      [{ migration_id: "20250101000000-create-users", status: "A", updated_at: new Date(), application_batch_id: 1 }],
      [1]
    );

    await showMigrationStatus("dev");

    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("20250101000000-create-users");
    spy.mockRestore();
  });

  describe("--json flag", () => {
    it("outputs valid JSON when json mode is active", async () => {
      setJsonMode(true);
      const { spy } = await makeConnectSpy(
        [{ migration_id: "20250101000000-users", status: "A", updated_at: new Date("2025-01-01"), application_batch_id: 1 }],
        [1]
      );

      await showMigrationStatus("dev");

      const written = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(() => JSON.parse(written)).not.toThrow();
      const parsed = JSON.parse(written);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0]).toHaveProperty("batch");
      expect(parsed[0]).toHaveProperty("migrations");
      spy.mockRestore();
    });

    it("JSON output contains migration data", async () => {
      setJsonMode(true);
      const { spy } = await makeConnectSpy(
        [{ migration_id: "20250101000000-users", status: "A", updated_at: new Date("2025-01-01"), application_batch_id: 1 }],
        [1]
      );

      await showMigrationStatus("dev");

      const written = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(written);
      expect(parsed[0].migrations[0].migration_id).toBe("20250101000000-users");
      expect(parsed[0].migrations[0].status).toBe("A");
      spy.mockRestore();
    });
  });

  describe("--limit option", () => {
    it("passes LIMIT clause to the query when --limit is set", async () => {
      const dbModule = await import("../src/db");
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);

      await showMigrationStatus("dev", { limit: "3" });

      const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
      const batchQuery = sqlCalls.find((s) => s.includes("SELECT DISTINCT application_batch_id"));
      expect(batchQuery).toContain("LIMIT 3");
      spy.mockRestore();
    });

    it("does not include LIMIT clause when --all is set", async () => {
      const dbModule = await import("../src/db");
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);

      await showMigrationStatus("dev", { all: true });

      const sqlCalls = mockClient.query.mock.calls.map((c) => c[0] as string);
      const batchQuery = sqlCalls.find((s) => s.includes("SELECT DISTINCT application_batch_id"));
      expect(batchQuery).not.toContain("LIMIT");
      spy.mockRestore();
    });
  });
});
