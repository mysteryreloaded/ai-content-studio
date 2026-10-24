import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  DecryptionFailed,
  decryptCredentials,
  encryptCredentials,
} from "./credentials.js";

const SECRET_KEY = randomBytes(32).toString("base64");

describe("credentials", () => {
  test("round-trips a plaintext", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    expect(decryptCredentials(blob, SECRET_KEY, "backend-1")).toBe(
      "hello world",
    );
  });

  test("fails to decrypt with the wrong backend id (associated data)", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    expect(() => decryptCredentials(blob, SECRET_KEY, "backend-2")).toThrow(
      DecryptionFailed,
    );
  });

  test("fails to decrypt with the wrong key", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptCredentials(blob, otherKey, "backend-1")).toThrow(
      DecryptionFailed,
    );
  });

  test("fails to decrypt a corrupted blob", () => {
    const blob = encryptCredentials("hello world", SECRET_KEY, "backend-1");
    const buffer = Buffer.from(blob, "base64");
    buffer[buffer.length - 1] = (buffer[buffer.length - 1] ?? 0) ^ 0xff;
    expect(() =>
      decryptCredentials(buffer.toString("base64"), SECRET_KEY, "backend-1"),
    ).toThrow(DecryptionFailed);
  });

  test("uses a fresh 12-byte nonce each time", () => {
    const a = encryptCredentials("same plaintext", SECRET_KEY, "backend-1");
    const b = encryptCredentials("same plaintext", SECRET_KEY, "backend-1");
    const nonceA = Buffer.from(a, "base64").subarray(0, 12);
    const nonceB = Buffer.from(b, "base64").subarray(0, 12);
    expect(nonceA.equals(nonceB)).toBe(false);
  });
});
