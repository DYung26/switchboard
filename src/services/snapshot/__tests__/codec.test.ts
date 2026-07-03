import { describe, expect, it } from "vitest";
import { decodeValue, encodeValue } from "../codec";

async function roundTrip(value: unknown): Promise<unknown> {
  return decodeValue(await encodeValue(value));
}

describe("codec", () => {
  it("round-trips primitives, null, and undefined", async () => {
    expect(await roundTrip("hello")).toBe("hello");
    expect(await roundTrip(42)).toBe(42);
    expect(await roundTrip(true)).toBe(true);
    expect(await roundTrip(null)).toBeNull();
    expect(await roundTrip(undefined)).toBeUndefined();
  });

  it("round-trips arrays and plain objects, including nested structures", async () => {
    const value = { a: 1, b: ["x", { c: true }], d: null };
    expect(await roundTrip(value)).toEqual(value);
  });

  it("round-trips a Date", async () => {
    const date = new Date("2024-03-01T12:00:00.000Z");
    const result = (await roundTrip(date)) as Date;
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(date.getTime());
  });

  it("round-trips a RegExp", async () => {
    const regexp = /foo.*bar/gi;
    const result = (await roundTrip(regexp)) as RegExp;
    expect(result).toBeInstanceOf(RegExp);
    expect(result.source).toBe(regexp.source);
    expect(result.flags).toBe(regexp.flags);
  });

  it("round-trips a Map with non-string keys", async () => {
    const map = new Map<unknown, unknown>([
      ["a", 1],
      [2, "two"],
    ]);
    const result = (await roundTrip(map)) as Map<unknown, unknown>;
    expect(result).toBeInstanceOf(Map);
    expect(result.get("a")).toBe(1);
    expect(result.get(2)).toBe("two");
  });

  it("round-trips a Set", async () => {
    const set = new Set([1, 2, 3]);
    const result = (await roundTrip(set)) as Set<number>;
    expect(result).toBeInstanceOf(Set);
    expect([...result]).toEqual([1, 2, 3]);
  });

  it("round-trips an ArrayBuffer", async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = (await roundTrip(buffer)) as ArrayBuffer;
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("round-trips a typed array, preserving its constructor", async () => {
    const typed = new Uint16Array([10, 20, 30]);
    const result = (await roundTrip(typed)) as Uint16Array;
    expect(result).toBeInstanceOf(Uint16Array);
    expect([...result]).toEqual([10, 20, 30]);
  });

  it("round-trips a Blob, preserving its MIME type", async () => {
    const blob = new Blob(["hello world"], { type: "text/plain" });
    const result = (await roundTrip(blob)) as Blob;
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("text/plain");
    const text = await result.text();
    expect(text).toBe("hello world");
  });

  it("falls back to 'unsupported' rather than throwing on a circular reference", async () => {
    const circular: Record<string, unknown> = { name: "a" };
    circular.self = circular;

    const encoded = await encodeValue(circular);
    const decoded = decodeValue(encoded) as Record<string, unknown>;

    expect(decoded.name).toBe("a");
    expect(decoded.self).toBeUndefined();
  });

  it("decodes an unrecognized serialized kind to undefined instead of throwing", () => {
    // @ts-expect-error - deliberately malformed input, simulating a
    // corrupted snapshot read back from storage.
    expect(decodeValue({ kind: "not-a-real-kind" })).toBeUndefined();
  });
});
