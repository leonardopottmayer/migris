import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { eject } from "../src/commands/eject";
import {
  makeTmpProject,
  writeMigration,
  writeObjectSource,
  writeConfig,
} from "./helpers/fixtures";

const exists = (...p: string[]) => fs.existsSync(path.join(...p));

describe("eject", () => {
  let root: string;
  let out: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = makeTmpProject("migris-eject-src-");
    out = makeTmpProject("migris-eject-out-");
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  describe("--module (vertical)", () => {
    beforeEach(() => {
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260102000000-schema-identity", module: "identity" });
      writeMigration(root, { id: "20260103000000-schema-notifications", module: "notifications" });
      writeObjectSource(root, { object: "default/functions/uuid", content: "FN\n" });
      writeObjectSource(root, { object: "identity/functions/hash", content: "FN\n" });
      writeObjectSource(root, { object: "notifications/views/pending", content: "VIEW\n" });
    });

    it("copies default + the module (and nothing else), preserving ids, with a template config", () => {
      eject({ module: "notifications", out });

      expect(exists(out, "migrations", "default", "20260101000000-ext")).toBe(true);
      expect(exists(out, "migrations", "notifications", "20260103000000-schema-notifications")).toBe(true);
      expect(exists(out, "migrations", "identity")).toBe(false);

      expect(exists(out, "objects", "default", "functions", "uuid.sql")).toBe(true);
      expect(exists(out, "objects", "notifications", "views", "pending.sql")).toBe(true);
      expect(exists(out, "objects", "identity")).toBe(false);

      const config = JSON.parse(fs.readFileSync(path.join(out, "config.json"), "utf8"));
      expect(config.environments).toBeTruthy();
    });

    it("accepts the positional module argument as sugar for --module", () => {
      eject({ module: "identity", out });
      expect(exists(out, "migrations", "identity", "20260102000000-schema-identity")).toBe(true);
      expect(exists(out, "migrations", "notifications")).toBe(false);
    });
  });

  describe("--tenant (horizontal)", () => {
    const OBJECT = "notifications/views/v-not-pending";

    beforeEach(() => {
      writeConfig(root, {
        acme: { host: "acme-db", port: 5432, user: "app", password: "secret", database: "pandora_acme" },
      });
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, {
        id: "20260102000000-add-view",
        module: "notifications",
        up: "VIEW COMMON\n",
        meta: { object: OBJECT, sourceChecksum: "c" },
      });
      writeObjectSource(root, { object: OBJECT, content: "VIEW COMMON\n" });
      // Tenant overlay: additive migration + object override (forked from latest common).
      writeMigration(root, {
        id: "20260103000000-acme-add-sla",
        module: "notifications",
        tenant: "acme",
      });
      writeMigration(root, {
        id: "20260104000000-acme-filter",
        module: "notifications",
        tenant: "acme",
        up: "VIEW ACME\n",
        meta: { object: OBJECT, sourceChecksum: "a", forkedFrom: "20260102000000-add-view" },
      });
      writeObjectSource(root, { object: OBJECT, content: "VIEW ACME\n", tenant: "acme" });
    });

    it("resolves the overlay: ids preserved, override suppresses common, objects resolved, config from env", () => {
      eject({ tenant: "acme", out });

      // ids preserved; suppressed common object-migration is gone, override present.
      expect(exists(out, "migrations", "default", "20260101000000-ext")).toBe(true);
      expect(exists(out, "migrations", "notifications", "20260103000000-acme-add-sla")).toBe(true);
      expect(exists(out, "migrations", "notifications", "20260104000000-acme-filter")).toBe(true);
      expect(exists(out, "migrations", "notifications", "20260102000000-add-view")).toBe(false);

      // Object resolved to the acme version, with no tenants/ concept.
      const resolved = fs.readFileSync(
        path.join(out, "objects", "notifications", "views", "v-not-pending.sql"),
        "utf8"
      );
      expect(resolved).toBe("VIEW ACME\n");
      expect(exists(out, "tenants")).toBe(false);

      const config = JSON.parse(fs.readFileSync(path.join(out, "config.json"), "utf8"));
      expect(config.environments.acme.database).toBe("pandora_acme");
      expect(config.environments.acme.password).toBe(""); // secret stripped
    });

    it("warns when an overridden object is behind the common version", () => {
      // Add a newer common version so the acme fork (forkedFrom v1) falls behind.
      writeMigration(root, {
        id: "20260201000000-add-next-field",
        module: "notifications",
        up: "VIEW COMMON V2\n",
        meta: { object: OBJECT, sourceChecksum: "c2" },
      });

      eject({ tenant: "acme", out });

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output.toLowerCase()).toContain("behind");
    });
  });

  it("squash collapses the selection into a single baseline migration", () => {
    writeMigration(root, { id: "20260101000000-ext", module: "default", up: "A\n" });
    writeMigration(root, { id: "20260102000000-notif", module: "notifications", up: "B\n" });

    eject({ module: "notifications", out, squash: true });

    const baselineDirs = fs.readdirSync(path.join(out, "migrations"));
    expect(baselineDirs).toHaveLength(1);
    expect(baselineDirs[0]).toMatch(/-baseline$/);
  });
});
