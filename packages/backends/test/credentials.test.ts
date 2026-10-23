import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { decryptCredentials, DecryptionFailed, encryptCredentials } from "../src/credentials";

const SECRET_KEY = randomBytes(32).toString("base64");

describe("credentials", () => {
  test("round-trips a plaintext", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    expect(decryptCredentials(blob, SECRET_KEY, "backend-1")).toBe("hello world");
  });

  test("fails to decrypt with the wrong backend id (associated data)", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    expect(() => decryptCredentials(blob, SECRET_KEY, "backend-2")).toThrow(DecryptionFailed);
  });

  test("fails to decrypt with the wrong key", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptCredentials(blob, otherKey, "backend-1")).toThrow(DecryptionFailed);
  });

  test("fails to decrypt a corrupted blob", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptCredentials(blob, SECRET_KEY, "backend-1")).toThrow(DecryptionFailed);
  });

  test("uses a fresh 12-byte nonce each time", () => {
    const a = encryptCredentials("same plaintext", SECRET_KEY, "backend-1");
    const b = encryptCredentials("same plaintext", SECRET_KEY, "backend-1");
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });
});
