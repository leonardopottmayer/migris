import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, setJsonMode, isJsonMode } from "../src/logger";

describe("logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setJsonMode(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    setJsonMode(false);
  });

  describe("plain mode", () => {
    it("log.info writes to stdout with ℹ prefix", () => {
      log.info("hello");
      expect(stdoutSpy).toHaveBeenCalledWith("ℹ hello\n");
    });

    it("log.success writes to stdout with ✅ prefix", () => {
      log.success("done");
      expect(stdoutSpy).toHaveBeenCalledWith("✅ done\n");
    });

    it("log.warn writes to stdout with ⚠️ prefix", () => {
      log.warn("careful");
      expect(stdoutSpy).toHaveBeenCalledWith("⚠️ careful\n");
    });

    it("log.error writes to stderr with ❌ prefix", () => {
      log.error("boom");
      expect(stderrSpy).toHaveBeenCalledWith("❌ boom\n");
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe("JSON mode", () => {
    beforeEach(() => setJsonMode(true));

    it("isJsonMode returns true when set", () => {
      expect(isJsonMode()).toBe(true);
    });

    it("log.info emits a JSON object to stdout", () => {
      log.info("hello");
      const written = (stdoutSpy.mock.calls[0]?.[0] as string) ?? "";
      const parsed = JSON.parse(written);
      expect(parsed).toEqual({ level: "info", message: "hello" });
    });

    it("log.error emits a JSON object to stdout (not stderr) in JSON mode", () => {
      log.error("boom");
      expect(stdoutSpy).toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
      const written = (stdoutSpy.mock.calls[0]?.[0] as string) ?? "";
      const parsed = JSON.parse(written);
      expect(parsed).toEqual({ level: "error", message: "boom" });
    });

    it("log.success emits level=success", () => {
      log.success("done");
      const written = (stdoutSpy.mock.calls[0]?.[0] as string) ?? "";
      expect(JSON.parse(written).level).toBe("success");
    });
  });

  describe("setJsonMode / isJsonMode", () => {
    it("isJsonMode returns false by default", () => {
      setJsonMode(false);
      expect(isJsonMode()).toBe(false);
    });

    it("isJsonMode reflects the value set by setJsonMode", () => {
      setJsonMode(true);
      expect(isJsonMode()).toBe(true);
      setJsonMode(false);
      expect(isJsonMode()).toBe(false);
    });
  });
});
