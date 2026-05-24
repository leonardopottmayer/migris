import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { initProject } from "../src/commands/init";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migris-init-test-"));
}

describe("initProject (no db)", () => {
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

  it("creates config.json when it does not exist", async () => {
    await initProject();
    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(true);
  });

  it("creates config.json with valid JSON content", async () => {
    await initProject();
    const raw = fs.readFileSync(path.join(tmpDir, "config.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("config.json template has an environments object", async () => {
    await initProject();
    const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
    expect(parsed).toHaveProperty("environments");
    expect(typeof parsed.environments).toBe("object");
  });

  it("config.json template has a dev environment", async () => {
    await initProject();
    const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, "config.json"), "utf8"));
    expect(parsed.environments).toHaveProperty("dev");
  });

  it("does not overwrite an existing config.json", async () => {
    const existing = JSON.stringify({ environments: { prod: {} } });
    fs.writeFileSync(path.join(tmpDir, "config.json"), existing);
    await initProject();
    const after = fs.readFileSync(path.join(tmpDir, "config.json"), "utf8");
    expect(after).toBe(existing);
  });

  it("creates migrations/ directory when it does not exist", async () => {
    await initProject();
    expect(fs.existsSync(path.join(tmpDir, "migrations"))).toBe(true);
    expect(fs.statSync(path.join(tmpDir, "migrations")).isDirectory()).toBe(true);
  });

  it("does not throw if migrations/ already exists", async () => {
    fs.mkdirSync(path.join(tmpDir, "migrations"));
    await expect(initProject()).resolves.toBeUndefined();
  });

  it("logs a tip to run migris init <env> when no env is provided", async () => {
    await initProject();
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("migris init <env>");
  });

  it("does not skip config.json creation message", async () => {
    await initProject();
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("config.json");
  });
});
