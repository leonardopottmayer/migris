import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createObject } from "../src/commands/create-object";
import { MigrisError } from "../src/errors";
import { discoverMigrations, objectLineage } from "../src/discovery";
import {
  makeTmpProject,
  writeMigration,
  writeObjectSource,
  readMetaOf,
} from "./helpers/fixtures";

const OBJECT = "notifications/views/v-not-pending";

function commonLineage(root: string) {
  return objectLineage(discoverMigrations(path.join(root, "migrations"), "common"), OBJECT);
}
function overlayLineage(root: string, tenant: string) {
  return objectLineage(
    discoverMigrations(path.join(root, "tenants", tenant, "migrations"), "overlay"),
    OBJECT
  );
}

describe("createObject", () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = makeTmpProject("migris-createobj-");
    // Seed a module migration so the project is detected as modular.
    writeMigration(root, { id: "20260101000000-ext", module: "default" });
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("v1: copies source to up, writes a placeholder down, and meta (no forkedFrom)", () => {
    writeObjectSource(root, { object: OBJECT, content: "CREATE OR REPLACE VIEW ... -- v1\n" });
    createObject(OBJECT, "add-pending-view");

    const [m] = commonLineage(root);
    expect(m).toBeTruthy();
    expect(m.modulePath).toEqual(["notifications"]); // destination derived from object module
    const up = fs.readFileSync(path.join(m.dir, `${m.id}.up.sql`), "utf8");
    const down = fs.readFileSync(path.join(m.dir, `${m.id}.down.sql`), "utf8");
    expect(up).toContain("v1");
    expect(down).not.toContain("CREATE OR REPLACE"); // placeholder, user writes the DROP
    const meta = readMetaOf(root, m.id, { module: "notifications" });
    expect(meta.object).toBe(OBJECT);
    expect(meta.sourceChecksum).toBeTruthy();
    expect(meta.forkedFrom).toBeUndefined();
  });

  it("v2+: down is the previous version's up", () => {
    // Pre-create v1 with an explicit older timestamp.
    writeMigration(root, {
      id: "20260101120000-add-pending-view",
      module: "notifications",
      up: "VIEW V1\n",
      down: "-- placeholder\n",
      meta: { object: OBJECT, sourceChecksum: "old" },
    });
    writeObjectSource(root, { object: OBJECT, content: "VIEW V2\n" });

    createObject(OBJECT, "add-next-attempt-field");

    const lineage = commonLineage(root);
    expect(lineage).toHaveLength(2);
    const v2 = lineage[1];
    const up = fs.readFileSync(path.join(v2.dir, `${v2.id}.up.sql`), "utf8");
    const down = fs.readFileSync(path.join(v2.dir, `${v2.id}.down.sql`), "utf8");
    expect(up).toBe("VIEW V2\n");
    expect(down).toBe("VIEW V1\n"); // previous up.sql, generated
  });

  it("--amend rewrites the most recent migration in place", () => {
    writeObjectSource(root, { object: OBJECT, content: "VIEW A\n" });
    createObject(OBJECT, "tune");
    const firstId = commonLineage(root)[0].id;

    writeObjectSource(root, { object: OBJECT, content: "VIEW B\n" });
    createObject(OBJECT, undefined, { amend: true });

    const lineage = commonLineage(root);
    expect(lineage).toHaveLength(1); // still one migration
    expect(lineage[0].id).toBe(firstId); // same folder
    const up = fs.readFileSync(path.join(lineage[0].dir, `${firstId}.up.sql`), "utf8");
    expect(up).toBe("VIEW B\n");
  });

  it("--dry-run writes nothing", () => {
    writeObjectSource(root, { object: OBJECT, content: "VIEW X\n" });
    createObject(OBJECT, "preview", { dryRun: true });
    expect(commonLineage(root)).toHaveLength(0);
  });

  it("throws when the object source does not exist", () => {
    expect(() => createObject(OBJECT, "missing")).toThrow(MigrisError);
  });

  describe("tenant override", () => {
    beforeEach(() => {
      // A common version exists first.
      writeMigration(root, {
        id: "20260101120000-add-pending-view",
        module: "notifications",
        up: "VIEW COMMON\n",
        meta: { object: OBJECT, sourceChecksum: "c" },
      });
    });

    it("writes forkedFrom = latest common id and a placeholder down (first fork)", () => {
      writeObjectSource(root, { object: OBJECT, content: "VIEW ACME\n", tenant: "acme" });
      createObject(OBJECT, "acme-filter", { tenant: "acme" });

      const [override] = overlayLineage(root, "acme");
      expect(override).toBeTruthy();
      const meta = readMetaOf(root, override.id, { tenant: "acme", module: "notifications" });
      expect(meta.forkedFrom).toBe("20260101120000-add-pending-view");
      const down = fs.readFileSync(path.join(override.dir, `${override.id}.down.sql`), "utf8");
      expect(down).not.toContain("VIEW COMMON"); // tenant owns its own lineage → v1 placeholder
    });
  });
});
