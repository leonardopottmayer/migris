import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createMigration } from "../src/commands/create";
import { MigrisError } from "../src/errors";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migris-create-test-"));
}

describe("createMigration", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("name validation", () => {
    it("rejects names with uppercase letters", () => {
      expect(() => createMigration("CreateUsers")).toThrow(MigrisError);
    });

    it("rejects names with spaces", () => {
      expect(() => createMigration("create users")).toThrow(MigrisError);
    });

    it("rejects names with underscores", () => {
      expect(() => createMigration("create_users")).toThrow(MigrisError);
    });

    it("rejects names starting with a hyphen", () => {
      expect(() => createMigration("-create-users")).toThrow(MigrisError);
    });

    it("rejects names ending with a hyphen", () => {
      expect(() => createMigration("create-users-")).toThrow(MigrisError);
    });

    it("rejects names with consecutive hyphens", () => {
      expect(() => createMigration("create--users")).toThrow(MigrisError);
    });

    it("rejects empty string", () => {
      expect(() => createMigration("")).toThrow(MigrisError);
    });

    it("rejects names with special characters", () => {
      expect(() => createMigration("create@users")).toThrow(MigrisError);
    });

    it("accepts simple lowercase name", () => {
      expect(() => createMigration("users")).not.toThrow();
    });

    it("accepts kebab-case name", () => {
      expect(() => createMigration("create-users-table")).not.toThrow();
    });

    it("accepts name with digits", () => {
      expect(() => createMigration("add-column-v2")).not.toThrow();
    });

    it("accepts single-segment lowercase name", () => {
      expect(() => createMigration("init")).not.toThrow();
    });
  });

  describe("file creation", () => {
    it("creates a migrations/ directory if it does not exist", () => {
      createMigration("create-users");
      expect(fs.existsSync(path.join(tmpDir, "migrations"))).toBe(true);
    });

    it("creates a timestamped subdirectory", () => {
      createMigration("create-users");
      const entries = fs.readdirSync(path.join(tmpDir, "migrations"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatch(/^\d{14}-create-users$/);
    });

    it("creates up.sql file", () => {
      createMigration("create-users");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations"));
      const upPath = path.join(tmpDir, "migrations", dir, `${dir}.up.sql`);
      expect(fs.existsSync(upPath)).toBe(true);
    });

    it("creates down.sql file", () => {
      createMigration("create-users");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations"));
      const downPath = path.join(tmpDir, "migrations", dir, `${dir}.down.sql`);
      expect(fs.existsSync(downPath)).toBe(true);
    });

    it("up.sql contains a comment with the filename", () => {
      createMigration("create-users");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations"));
      const content = fs.readFileSync(
        path.join(tmpDir, "migrations", dir, `${dir}.up.sql`),
        "utf8"
      );
      expect(content).toContain(".up.sql");
    });

    it("down.sql contains a comment with the filename", () => {
      createMigration("create-users");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations"));
      const content = fs.readFileSync(
        path.join(tmpDir, "migrations", dir, `${dir}.down.sql`),
        "utf8"
      );
      expect(content).toContain(".down.sql");
    });

    it("directory name starts with a 14-digit timestamp", () => {
      createMigration("init");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations"));
      expect(dir).toMatch(/^\d{14}-/);
    });

    it("creates two separate migrations with different timestamps", async () => {
      createMigration("first");
      await new Promise((r) => setTimeout(r, 1100));
      createMigration("second");
      const entries = fs.readdirSync(path.join(tmpDir, "migrations")).sort();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toContain("first");
      expect(entries[1]).toContain("second");
    });

    it("throws MigrisError if the migration directory already exists", () => {
      const fake = path.join(tmpDir, "migrations", "20991231235959-create-users");
      fs.mkdirSync(fake, { recursive: true });
      createMigration("no-collision");
      const [dir] = fs.readdirSync(path.join(tmpDir, "migrations")).filter((d) =>
        d.includes("no-collision")
      );
      const collidingPath = path.join(tmpDir, "migrations", dir);
      fs.mkdirSync(path.join(tmpDir, "migrations", "20991231235959-duplicate"), {
        recursive: true,
      });
      expect(collidingPath).toBeTruthy();
    });
  });

  describe("output", () => {
    it("logs a success message after creating", () => {
      createMigration("test-migration");
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("test-migration");
    });
  });

  describe("modules", () => {
    function seedModular() {
      const dir = path.join(tmpDir, "migrations", "default", "20260101000000-ext");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "20260101000000-ext.up.sql"), "SELECT 1;");
      fs.writeFileSync(path.join(dir, "20260101000000-ext.down.sql"), "SELECT 0;");
    }

    it("requires --module in a modular project", () => {
      seedModular();
      expect(() => createMigration("add-thing")).toThrow(MigrisError);
    });

    it("forbids --module in a flat project", () => {
      const dir = path.join(tmpDir, "migrations", "20260101000000-flat");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "20260101000000-flat.up.sql"), "SELECT 1;");
      fs.writeFileSync(path.join(dir, "20260101000000-flat.down.sql"), "SELECT 0;");
      expect(() => createMigration("add-thing", { module: "identity" })).toThrow(MigrisError);
    });

    it("creates the migration under the module folder", () => {
      seedModular();
      createMigration("create-notification", { module: "notifications" });
      const entries = fs.readdirSync(path.join(tmpDir, "migrations", "notifications"));
      expect(entries.some((e) => e.endsWith("-create-notification"))).toBe(true);
    });

    it("rejects a duplicate migration id across modules (global uniqueness)", () => {
      seedModular();
      // Pre-create an id, then force the same timestamp by mocking Date.
      const dup = path.join(tmpDir, "migrations", "identity", "20991231235959-dupe");
      fs.mkdirSync(dup, { recursive: true });
      fs.writeFileSync(path.join(dup, "20991231235959-dupe.up.sql"), "SELECT 1;");
      fs.writeFileSync(path.join(dup, "20991231235959-dupe.down.sql"), "SELECT 0;");
      const realDate = global.Date;
      // Freeze time so createMigration generates the colliding id.
      vi.spyOn(global, "Date").mockImplementation(() => new realDate("2099-12-31T23:59:59Z") as unknown as Date);
      try {
        expect(() => createMigration("dupe", { module: "notifications" })).toThrow(MigrisError);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
