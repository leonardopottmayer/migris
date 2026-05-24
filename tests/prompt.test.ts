import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { confirm } from "../src/prompt";

describe("confirm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns true immediately in non-TTY environments", async () => {
    // In the test runner stdin.isTTY is undefined/false, so confirm auto-approves.
    const result = await confirm("proceed?");
    expect(result).toBe(true);
  });

  it("resolves without hanging", async () => {
    const result = await Promise.race([
      confirm("test?"),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 500)),
    ]);
    expect(result).toBe(true);
  });
});
