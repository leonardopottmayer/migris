import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import { applyMigrations } from "../src/commands/apply";
import { makeTmpProject, writeMigration } from "./helpers/fixtures";

const OBJECT = "notifications/views/v-not-pending";

/** Mocks the DB client so every migration looks pending; records applied ids. */
async function mockApply(appliedOrder: string[]) {
  const dbModule = await import("../src/db");
  const mockClient = {
    query: vi.fn().mockImplementation((sql: string, params?: string[]) => {
      if (sql.includes("MAX(application_batch_id)")) return Promise.resolve({ rows: [{ max: 0 }] });
      if (sql.includes("SELECT 1 FROM migrations")) return Promise.resolve({ rowCount: 0, rows: [] });
      if (sql.includes("SELECT checksum")) return Promise.resolve({ rows: [] });
      if (sql === "BEGIN" || sql === "COMMIT") return Promise.resolve({});
      if (sql.includes("INSERT INTO migrations")) {
        if (params?.[0]) appliedOrder.push(params[0]);
        return Promise.resolve({});
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const spy = vi.spyOn(dbModule, "createConnectedClient").mockResolvedValue(mockClient as never);
  return spy;
}

describe("multi-tenant apply", () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = makeTmpProject("migris-tenants-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    writeMigration(root, { id: "20260101000000-ext", module: "default" });
    writeMigration(root, {
      id: "20260102000000-add-view",
      module: "notifications",
      meta: { object: OBJECT, sourceChecksum: "c" },
    });
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("applies only the common timeline for an env without an overlay", async () => {
    const applied: string[] = [];
    const spy = await mockApply(applied);
    await applyMigrations("homolog", { yes: true });
    expect(applied).toEqual(["20260101000000-ext", "20260102000000-add-view"]);
    spy.mockRestore();
  });

  it("applies common + overlay and suppresses the overridden common object-migration", async () => {
    writeMigration(root, {
      id: "20260103000000-acme-add-sla",
      module: "notifications",
      tenant: "acme",
    });
    writeMigration(root, {
      id: "20260104000000-acme-filter",
      module: "notifications",
      tenant: "acme",
      meta: { object: OBJECT, sourceChecksum: "a", forkedFrom: "20260102000000-add-view" },
    });

    const applied: string[] = [];
    const spy = await mockApply(applied);
    await applyMigrations("acme", { yes: true });

    expect(applied).toEqual([
      "20260101000000-ext",
      "20260103000000-acme-add-sla",
      "20260104000000-acme-filter",
    ]);
    expect(applied).not.toContain("20260102000000-add-view"); // suppressed by override
    spy.mockRestore();
  });
});
