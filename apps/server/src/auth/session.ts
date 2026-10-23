import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE_NAME = "__Host-session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDING_BUMP_MIN_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
}

export interface Session {
  id: string;
  user: SessionUser;
}

function sha256Hex(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}

/** Creates a session row for `userId` and returns the cookie value to set. */
export async function createSession(
  db: Database,
  clock: Clock,
  userId: string,
): Promise<{ cookieValue: string; expiresAt: Date }> {
  const id = randomToken();
  const secret = randomToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id,
    secretHash: sha256Hex(secret),
    userId,
    expiresAt,
    lastSeenAt: now,
    createdAt: now,
  });

  return { cookieValue: `${id}.${secret}`, expiresAt };
}

export async function deleteSession(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Parses the session cookie, verifies the secret and loads the user's
 * current role/status. Bumps the sliding expiry at most once an hour.
 * Returns `null` for a missing, malformed, unknown, mismatched or
 * expired session — callers never need to know which.
 */
export async function readSession(
  db: Database,
  clock: Clock,
  cookieValue: string | undefined,
): Promise<Session | null> {
  if (!cookieValue) return null;
  const separator = cookieValue.indexOf(".");
  if (separator < 0) return null;
  const id = cookieValue.slice(0, separator);
  const secret = cookieValue.slice(separator + 1);
  if (!id || !secret) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      secretHash: sessions.secretHash,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      picture: users.picture,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  const now = clock.now();
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  if (!timingSafeEqual(sha256Hex(secret), row.secretHash)) return null;

  if (
    now.getTime() - row.lastSeenAt.getTime() >=
    SLIDING_BUMP_MIN_INTERVAL_MS
  ) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, id));
  }

  return {
    id: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      picture: row.picture,
      role: row.role,
      status: row.status,
    },
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
