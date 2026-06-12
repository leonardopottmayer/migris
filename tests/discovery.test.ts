import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import {
  detectMode,
  discoverMigrations,
  effectiveMigrations,
  collectAllIds,
  listModules,
} from "../src/discovery";
import { makeTmpProject, writeMigration } from "./helpers/fixtures";
import path from "path";

describe("discovery", () => {
  const dirs: string[] = [];
  const project = (prefix?: string) => {
    const d = makeTmpProject(prefix);
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  describe("detectMode", () => {
    it("is flat when migrations/ has a direct leaf folder", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-users" });
      expect(detectMode(root)).toBe("flat");
    });

    it("is modular when leaves live under module folders only", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260102000000-user", module: "identity" });
      expect(detectMode(root)).toBe("modular");
    });

    it("is flat for an empty/uninitialized project", () => {
      const root = project();
      expect(detectMode(root)).toBe("flat");
      fs.mkdirSync(path.join(root, "migrations"));
      expect(detectMode(root)).toBe("flat");
    });

    it("ignores empty folders when detecting mode", () => {
      const root = project();
      fs.mkdirSync(path.join(root, "migrations", "20991231235959-fake"), { recursive: true });
      expect(detectMode(root)).toBe("flat");
    });
  });

  describe("discoverMigrations", () => {
    it("recursively finds leaf folders and records their module path", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260102000000-user", module: "identity" });
      const found = discoverMigrations(path.join(root, "migrations"), "common");
      expect(found.map((m) => m.id).sort()).toEqual([
        "20260101000000-ext",
        "20260102000000-user",
      ]);
      const user = found.find((m) => m.id === "20260102000000-user")!;
      expect(user.modulePath).toEqual(["identity"]);
    });

    it("parses meta.json when present", () => {
      const root = project();
      writeMigration(root, {
        id: "20260101000000-add-view",
        module: "notifications",
        meta: { object: "notifications/views/v-x", sourceChecksum: "abc" },
      });
      const [m] = discoverMigrations(path.join(root, "migrations"), "common");
      expect(m.meta?.object).toBe("notifications/views/v-x");
    });
  });

  describe("listModules", () => {
    it("lists only modules that actually contain migrations", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260102000000-user", module: "identity" });
      fs.mkdirSync(path.join(root, "migrations", "empty"), { recursive: true });
      expect(listModules(root)).toEqual(["default", "identity"]);
    });
  });

  describe("effectiveMigrations", () => {
    it("merge-sorts across modules by timestamp", () => {
      const root = project();
      writeMigration(root, { id: "20260131000000-ext", module: "default" });
      writeMigration(root, { id: "20260604000000-notif", module: "notifications" });
      writeMigration(root, { id: "20260201000000-user", module: "identity" });
      const ids = effectiveMigrations(root, "dev").map((m) => m.id);
      expect(ids).toEqual([
        "20260131000000-ext",
        "20260201000000-user",
        "20260604000000-notif",
      ]);
    });

    it("includes the tenant overlay when present", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260605000000-acme-extra", module: "notifications", tenant: "acme" });
      const ids = effectiveMigrations(root, "acme").map((m) => m.id);
      expect(ids).toContain("20260605000000-acme-extra");
    });

    it("applies only the common timeline for an env without an overlay", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260605000000-acme-extra", module: "notifications", tenant: "acme" });
      const ids = effectiveMigrations(root, "homolog").map((m) => m.id);
      expect(ids).toEqual(["20260101000000-ext"]);
    });

    it("suppresses the common object-migration when the tenant overrides that object", () => {
      const root = project();
      const obj = "notifications/views/v-not-pending";
      writeMigration(root, {
        id: "20260101000000-add-view",
        module: "notifications",
        meta: { object: obj, sourceChecksum: "c1" },
      });
      writeMigration(root, {
        id: "20260610000000-acme-filter",
        module: "notifications",
        tenant: "acme",
        meta: { object: obj, sourceChecksum: "c2", forkedFrom: "20260101000000-add-view" },
      });
      const ids = effectiveMigrations(root, "acme").map((m) => m.id);
      expect(ids).toEqual(["20260610000000-acme-filter"]); // common suppressed, override wins
    });

    it("does not suppress when there is no override", () => {
      const root = project();
      const obj = "notifications/views/v-not-pending";
      writeMigration(root, {
        id: "20260101000000-add-view",
        module: "notifications",
        meta: { object: obj, sourceChecksum: "c1" },
      });
      const ids = effectiveMigrations(root, "acme").map((m) => m.id);
      expect(ids).toEqual(["20260101000000-add-view"]);
    });
  });

  describe("collectAllIds", () => {
    it("gathers ids from common and every overlay for global uniqueness", () => {
      const root = project();
      writeMigration(root, { id: "20260101000000-ext", module: "default" });
      writeMigration(root, { id: "20260605000000-acme-extra", module: "notifications", tenant: "acme" });
      const ids = collectAllIds(root);
      expect(ids.has("20260101000000-ext")).toBe(true);
      expect(ids.has("20260605000000-acme-extra")).toBe(true);
    });
  });
});
