import { describe, expect, it } from "vitest";
import { withTimeout, TimeoutError } from "../with-timeout";

describe("withTimeout", () => {
  it("resolves with the original value when it settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 50);
    expect(result).toBe("done");
  });

  it("rejects with TimeoutError when the promise never settles", async () => {
    const neverSettles = new Promise<string>(() => {});
    await expect(withTimeout(neverSettles, 10)).rejects.toThrow(TimeoutError);
  });

  it("propagates the original rejection when it rejects before the timeout", async () => {
    const failing = Promise.reject(new Error("boom"));
    await expect(withTimeout(failing, 50)).rejects.toThrow("boom");
  });
});
