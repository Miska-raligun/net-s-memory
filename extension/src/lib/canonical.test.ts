import { describe, expect, it } from "vitest";
import { bytesToHex, canonicalEncode, hexToBytes, sha256Hex } from "./canonical";

const dec = new TextDecoder();
const enc = (v: Parameters<typeof canonicalEncode>[0]) => dec.decode(canonicalEncode(v));

describe("canonicalEncode", () => {
  it("sorts object keys lexicographically", () => {
    expect(enc({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("escapes non-ASCII as lowercase \\uXXXX", () => {
    expect(enc("记忆")).toBe('"\\u8bb0\\u5fc6"');
  });

  it("rejects floats", () => {
    expect(() => canonicalEncode(1.5)).toThrow();
  });

  it("emits no whitespace in nested structures", () => {
    expect(enc({ x: [1, 2], y: { z: "a" } })).toBe('{"x":[1,2],"y":{"z":"a"}}');
  });
});

describe("hex helpers", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 15, 16, 255]);
    expect(bytesToHex(bytes)).toBe("000f10ff");
    expect(hexToBytes("000f10ff")).toEqual(bytes);
  });
});

describe("sha256Hex", () => {
  it("hashes a known string", async () => {
    // sha256("abc")
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
