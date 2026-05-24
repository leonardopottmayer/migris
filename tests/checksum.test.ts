import { describe, it, expect } from "vitest";
import { computeChecksum } from "../src/checksum";

describe("computeChecksum", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const result = computeChecksum("SELECT 1;");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for identical content", () => {
    const a = computeChecksum("CREATE TABLE users (id SERIAL PRIMARY KEY);");
    const b = computeChecksum("CREATE TABLE users (id SERIAL PRIMARY KEY);");
    expect(a).toBe(b);
  });

  it("returns different hashes for different content", () => {
    const a = computeChecksum("SELECT 1;");
    const b = computeChecksum("SELECT 2;");
    expect(a).not.toBe(b);
  });

  it("handles empty string", () => {
    const result = computeChecksum("");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is sensitive to whitespace differences", () => {
    const a = computeChecksum("SELECT 1;");
    const b = computeChecksum("SELECT 1; ");
    expect(a).not.toBe(b);
  });
});
