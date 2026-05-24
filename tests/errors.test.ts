import { describe, it, expect } from "vitest";
import { MigrisError } from "../src/errors";

describe("MigrisError", () => {
  it("is an instance of Error", () => {
    expect(new MigrisError("oops")).toBeInstanceOf(Error);
  });

  it("has name MigrisError", () => {
    expect(new MigrisError("oops").name).toBe("MigrisError");
  });

  it("defaults to exitCode 1", () => {
    expect(new MigrisError("oops").exitCode).toBe(1);
  });

  it("accepts a custom exitCode", () => {
    expect(new MigrisError("pending", 2).exitCode).toBe(2);
  });

  it("stores the message", () => {
    expect(new MigrisError("something went wrong").message).toBe("something went wrong");
  });
});
