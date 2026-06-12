import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import { findDrift, drift } from "../src/commands/drift";
import { createObject } from "../src/commands/create-object";
import { MigrisError } from "../src/errors";
import {
  makeTmpProject,
  writeMigration,
  writeObjectSource,
  readMetaOf,
} from "./helpers/fixtures";

const OBJECT = "notifications/views/v-not-pending";
const C1 = "20260101120000-add-pending-view";
const C2 = "20260201120000-add-next-attempt-field";
const OVERRIDE = "20260110120000-acme-filter";

describe("drift", () => {
  let root: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = makeTmpProject("migris-drift-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // Module seed + common object lineage (v1 then v2).
    writeMigration(root, { id: "20260101000000-ext", module: "default" });
    writeMigration(root, {
      id: C1,
      module: "notifications",
      up: "VIEW V1\n",
      meta: { object: OBJECT, sourceChecksum: "c1" },
    });
    writeMigration(root, {
      id: C2,
      module: "notifications",
      up: "VIEW V2\n",
      meta: { object: OBJECT, sourceChecksum: "c2" },
    });
    // Tenant override forked from v1 (now behind v2).
    writeMigration(root, {
      id: OVERRIDE,
      module: "notifications",
      tenant: "acme",
      up: "VIEW ACME\n",
      meta: { object: OBJECT, sourceChecksum: "a1", forkedFrom: C1 },
    });
    writeObjectSource(root, { object: OBJECT, content: "VIEW ACME\n", tenant: "acme" });
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects an override that is behind the common version, with the upstream diff", () => {
    const behind = findDrift(root, "acme");
    expect(behind).toHaveLength(1);
    expect(behind[0].object).toBe(OBJECT);
    expect(behind[0].forkedFrom).toBe(C1);
    expect(behind[0].latestCommon).toBe(C2);
    expect(behind[0].diff).toContain("V1"); // fork base
    expect(behind[0].diff).toContain("V2"); // current common
  });

  it("--rebase advances forkedFrom and clears the alert", () => {
    createObject(OBJECT, undefined, { tenant: "acme", rebase: true });
    const meta = readMetaOf(root, OVERRIDE, { tenant: "acme", module: "notifications" });
    expect(meta.forkedFrom).toBe(C2);
    expect(findDrift(root, "acme")).toHaveLength(0);
  });

  it("regenerating the override without --rebase does NOT clear the alert", () => {
    createObject(OBJECT, undefined, { tenant: "acme", amend: true });
    const meta = readMetaOf(root, OVERRIDE, { tenant: "acme", module: "notifications" });
    expect(meta.forkedFrom).toBe(C1); // pointer preserved
    expect(findDrift(root, "acme")).toHaveLength(1);
  });

  it("--strict throws (CI gate) when a fork is behind, and stays quiet when clean", () => {
    expect(() => drift("acme", { strict: true })).toThrow(MigrisError);
    createObject(OBJECT, undefined, { tenant: "acme", rebase: true });
    expect(() => drift("acme", { strict: true })).not.toThrow();
  });
});
