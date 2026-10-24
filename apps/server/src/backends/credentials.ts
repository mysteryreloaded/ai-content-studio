// Backend credentials at rest: AES-256-GCM, a random 12-byte nonce, the key
// from SECRET_KEY and the Backend id as associated data (issue #39). The
// Backend id in the AAD means a decrypted blob can't be replayed onto a
// different Backend's row.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class DecryptionFailed extends Error {
  constructor() {
    super("could not decrypt Backend credentials");
  }
}

function loadKey(secretKey: string): Buffer {
  const key = Buffer.from(secretKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "SECRET_KEY must decode (base64) to 32 bytes for AES-256-GCM",
    );
  }
  return key;
}

/** Encrypts `plaintext` (JSON-encoded credentials) for one Backend, returning a base64 blob for storage. */
export function encryptCredentials(
  plaintext: string,
  secretKey: string,
  backendId: string,
): string {
  const key = loadKey(secretKey);
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(backendId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, authTag]).toString("base64");
}

/** Decrypts a blob produced by {@link encryptCredentials}. Throws {@link DecryptionFailed} on any mismatch. */
export function decryptCredentials(
  blob: string,
  secretKey: string,
  backendId: string,
): string {
  const buffer = Buffer.from(blob, "base64");
  if (buffer.length < NONCE_LENGTH + AUTH_TAG_LENGTH) {
    throw new DecryptionFailed();
  }
  try {
    const key = loadKey(secretKey);
    const nonce = buffer.subarray(0, NONCE_LENGTH);
    const authTag = buffer.subarray(buffer.length - AUTH_TAG_LENGTH);
    const ciphertext = buffer.subarray(
      NONCE_LENGTH,
      buffer.length - AUTH_TAG_LENGTH,
    );
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(backendId, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new DecryptionFailed();
  }
}
