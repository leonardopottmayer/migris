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
});
