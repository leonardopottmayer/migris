import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { checkMigrations } from "../src/commands/check";
import { MigrisError } from "../src/errors";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migris-check-test-"));
}

describe("checkMigrations", () => {
  let tmpDir: string;
  let migrationsDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    migrationsDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migrationsDir);
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws MigrisError when migrations/ directory does not exist", async () => {
    fs.rmSync(migrationsDir, { recursive: true });
    await expect(checkMigrations("dev")).rejects.toThrow(MigrisError);
  });
});
