import { describe, expect, it } from "vitest";
import { describeMechanismFailures } from "../snapshot-error";

describe("describeMechanismFailures", () => {
  it("joins mechanism names with their error messages", () => {
    const description = describeMechanismFailures([
      { mechanism: "indexedDB", error: new Error("blocked by another tab") },
      { mechanism: "cacheStorage", error: new Error("quota exceeded") },
    ]);

    expect(description).toBe(
      "indexedDB: blocked by another tab; cacheStorage: quota exceeded",
    );
  });

  it("stringifies non-Error failure values", () => {
    const description = describeMechanismFailures([
      { mechanism: "cookies", error: "permission denied" },
    ]);

    expect(description).toBe("cookies: permission denied");
  });
});
