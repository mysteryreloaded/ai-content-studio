import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalStorage } from "./storage.js";

describe("local-disk storage", () => {
  const rootPromise = mkdtemp(path.join(tmpdir(), "storage-test-"));

  afterAll(async () => {
    await rm(await rootPromise, { recursive: true, force: true });
  });

  test("write, read, stat and delete round-trip a key", async () => {
    const storage = createLocalStorage(await rootPromise);
    const data = new TextEncoder().encode("hello branding");

    expect(await storage.stat("branding/logo")).toBeNull();

    await storage.write("branding/logo", data);

    const stat = await storage.stat("branding/logo");
    expect(stat?.size).toBe(data.byteLength);

    const read = await storage.read("branding/logo");
    expect(read.equals(Buffer.from(data))).toBe(true);

    await storage.delete("branding/logo");
    expect(await storage.stat("branding/logo")).toBeNull();
  });

  test("rejects keys that escape the root", async () => {
    const storage = createLocalStorage(await rootPromise);
    await expect(
      storage.write("../escape", new Uint8Array()),
    ).rejects.toThrow();
  });

  test("writeAt appends at an offset, dropping anything past it (issue #50)", async () => {
    const storage = createLocalStorage(await rootPromise);
    const enc = new TextEncoder();
    await storage.writeAt("uploads/u1/original", 0, enc.encode("abcXYZ"));
    // A resumed chunk at offset 3 replaces the partial "XYZ" tail.
    await storage.writeAt("uploads/u1/original", 3, enc.encode("def"));
    await storage.writeAt("uploads/u1/original", 6, enc.encode("gh"));
    const read = await storage.read("uploads/u1/original");
    expect(read.toString()).toBe("abcdefgh");
  });
});
