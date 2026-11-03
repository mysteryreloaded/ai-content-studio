// `createSession`/`readSession` (issue #208): a sign-in sets the user's
// `lastSignInAt` and `lastSeenAt`, and a verified session moves
// `lastSeenAt` again once the sliding-bump throttle has elapsed.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { users } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { createSession, readSession } from "./session.js";

describe("session activity bumps the user's lastSignInAt/lastSeenAt", () => {
  const testDb = createTestDatabase("session_activity_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(users);
  });

  async function makeUser() {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${crypto.randomUUID()}`,
        email: "activity@example.com",
        name: "Activity User",
        role: "user",
        status: "active",
        pinned: false,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    return user;
  }

  test("createSession sets lastSignInAt and lastSeenAt", async () => {
    const { db } = await testDb;
    const user = await makeUser();
    expect(user.lastSignInAt).toBeNull();
    expect(user.lastSeenAt).toBeNull();

    await createSession(db, clock, user.id);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.lastSignInAt).toEqual(clock.now());
    expect(row?.lastSeenAt).toEqual(clock.now());
  });

  test("a verified session moves lastSeenAt once the sliding bump's hour has elapsed, not before", async () => {
    const { db } = await testDb;
    const user = await makeUser();
    const session = await createSession(db, clock, user.id);
    const signedInAt = clock.now();

    // Just under the hour: no bump.
    clock.advance(59 * 60 * 1000);
    await readSession(db, clock, session.cookieValue);
    let [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.lastSeenAt).toEqual(signedInAt);

    // Past the hour: bumped, lastSignInAt untouched.
    clock.advance(2 * 60 * 1000);
    await readSession(db, clock, session.cookieValue);
    [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.lastSeenAt).toEqual(clock.now());
    expect(row?.lastSignInAt).toEqual(signedInAt);
  });
});
