import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import { scanBoundaryViolations } from "../src/boundary";
import { validate } from "../src/commands/validate";
import { MigrisError } from "../src/errors";
import { makeTmpProject, writeMigration, writeConfig } from "./helpers/fixtures";

describe("boundary validation", () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = makeTmpProject("migris-boundary-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Two real modules so there is a boundary to cross.
    writeMigration(root, { id: "20260101000000-ext", module: "default", up: "CREATE EXTENSION pgcrypto;\n" });
    writeMigration(root, { id: "20260102000000-schema-identity", module: "identity", up: "CREATE SCHEMA identity;\n" });
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("flags a cross-module schema reference", () => {
    writeMigration(root, {
      id: "20260103000000-bad",
      module: "notifications",
      up: "SELECT * FROM identity.users;\n",
    });
    const violations = scanBoundaryViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ module: "notifications", referenced: "identity" });
  });

  it("allows references to the default module", () => {
    writeMigration(root, {
      id: "20260103000000-ok",
      module: "notifications",
      up: "SELECT default.uuid_generate_v7();\n",
    });
    expect(scanBoundaryViolations(root)).toHaveLength(0);
  });

  it("ignores schema names that only appear inside comments", () => {
    writeMigration(root, {
      id: "20260103000000-comment",
      module: "notifications",
      up: "-- references identity.users in a comment only\nSELECT 1;\n",
    });
    expect(scanBoundaryViolations(root)).toHaveLength(0);
  });

  it("validate --strict throws when violations exist", () => {
    writeMigration(root, {
      id: "20260103000000-bad",
      module: "notifications",
      up: "SELECT * FROM identity.users;\n",
    });
    expect(() => validate({ strict: true })).toThrow(MigrisError);
  });

  it("validate without --strict does not throw", () => {
    writeMigration(root, {
      id: "20260103000000-bad",
      module: "notifications",
      up: "SELECT * FROM identity.users;\n",
    });
    expect(() => validate({})).not.toThrow();
  });

  it("validate warns about an orphan tenant overlay (folder without a config env)", () => {
    writeConfig(root, {
      acme: { host: "h", port: 5432, user: "u", password: "p", database: "d" },
    });
    // overlay folder for a tenant that is NOT in config.json
    writeMigration(root, { id: "20260103000000-ghost", module: "notifications", tenant: "ghost" });
    validate({});
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out.toLowerCase()).toContain("orphan overlay");
    expect(out).toContain("ghost");
  });
});
