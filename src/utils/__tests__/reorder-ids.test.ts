import { describe, expect, it } from "vitest";
import { reorderIds } from "../reorder-ids";

describe("reorderIds", () => {
  it("moves an id before a later target", () => {
    expect(reorderIds(["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("moves an id before an earlier target", () => {
    expect(reorderIds(["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("returns the original array when the dragged id is unknown", () => {
    const ids = ["a", "b", "c"];
    expect(reorderIds(ids, "missing", "b")).toBe(ids);
  });

  it("returns the original array when the target id is unknown", () => {
    const ids = ["a", "b", "c"];
    expect(reorderIds(ids, "a", "missing")).toBe(ids);
  });

  it("returns the original array when dragging onto itself", () => {
    const ids = ["a", "b", "c"];
    expect(reorderIds(ids, "b", "b")).toBe(ids);
  });
});
