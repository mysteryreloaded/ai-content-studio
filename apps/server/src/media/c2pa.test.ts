// c2pa.ts's pure helpers (issue #75's AC: arm64 and unsupported formats
// get the "AI-generated" tag only), plus signAssetWithC2pa's temp-file
// behaviour against a fake c2patool.

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildManifest,
  c2paSupportsArch,
  c2paSupportsFormat,
  signAssetWithC2pa,
} from "./c2pa.js";

describe("c2paSupportsArch", () => {
  test("arm64 is unsupported (c2patool has no arm64 Linux build)", () => {
    expect(c2paSupportsArch("arm64")).toBe(false);
  });

  test("amd64/x64 is supported", () => {
    expect(c2paSupportsArch("x64")).toBe(true);
  });
});

describe("c2paSupportsFormat", () => {
  test.each([
    ["video.mp4", true],
    ["video.MOV", true],
    ["photo.png", true],
    ["photo.jpg", true],
    ["photo.jpeg", true],
    ["anim.webp", true],
    ["anim.gif", true],
    ["clip.wav", true],
    ["clip.mp3", true],
    ["clip.flac", true],
    ["clip.m4a", true],
  ])("%s is supported", (filename, expected) => {
    expect(c2paSupportsFormat(filename)).toBe(expected);
  });

  test.each([
    ["video.webm", false],
    ["clip.ogg", false],
    ["clip.opus", false],
    ["no-extension", false],
  ])("%s is not supported", (filename, expected) => {
    expect(c2paSupportsFormat(filename)).toBe(expected);
  });
});

describe("buildManifest", () => {
  test("holds c2pa.created + trainedAlgorithmicMedia, the Model, the site title and the Generation id", () => {
    const manifest = buildManifest(
      { certPath: "/certs/cert.pem", keyPath: "/certs/key.pem" },
      {
        modelName: "LTX 2.5",
        siteTitle: "My Studio",
        generationId: "gen-1",
      },
    ) as {
      title: string;
      sign_cert: string;
      private_key: string;
      ta_url?: string;
      assertions: Array<{ label: string; data: unknown }>;
    };

    expect(manifest.title).toBe("My Studio");
    expect(manifest.sign_cert).toBe("/certs/cert.pem");
    expect(manifest.private_key).toBe("/certs/key.pem");
    expect(manifest.ta_url).toBeUndefined();

    const actions = manifest.assertions.find((a) => a.label === "c2pa.actions")
      ?.data as {
      actions: Array<{ action: string; digitalSourceType: string }>;
    };
    expect(actions.actions[0]?.action).toBe("c2pa.created");
    expect(actions.actions[0]?.digitalSourceType).toBe(
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    );

    const generation = manifest.assertions.find((a) =>
      a.label.endsWith(".generation"),
    )?.data as { model: string; site: string; generationId: string };
    expect(generation).toEqual({
      model: "LTX 2.5",
      site: "My Studio",
      generationId: "gen-1",
    });
  });

  test("includes ta_url only when a timestamp URL is configured", () => {
    const manifest = buildManifest(
      {
        certPath: "/certs/cert.pem",
        keyPath: "/certs/key.pem",
        timestampUrl: "http://timestamp.example.com",
      },
      { modelName: "LTX 2.5", siteTitle: "My Studio", generationId: "gen-1" },
    ) as { ta_url?: string };
    expect(manifest.ta_url).toBe("http://timestamp.example.com");
  });
});

describe("signAssetWithC2pa", () => {
  test("replaces the asset with the signed output and cleans up the manifest temp file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "c2pa-test-"));
    try {
      const assetPath = path.join(dir, "asset.png");
      await writeFile(assetPath, "original bytes");

      const tool = {
        signC2pa: async (
          _assetPath: string,
          manifestPath: string,
          outputPath: string,
        ) => {
          const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
          expect(manifest.title).toBe("My Studio");
          await writeFile(outputPath, "signed bytes");
        },
      };

      const warnings: string[] = [];
      await signAssetWithC2pa(
        tool,
        assetPath,
        { certPath: "/certs/cert.pem", keyPath: "/certs/key.pem" },
        { modelName: "LTX 2.5", siteTitle: "My Studio", generationId: "gen-1" },
        (message) => warnings.push(message),
      );

      expect(warnings).toEqual([]);
      expect(await readFile(assetPath, "utf-8")).toBe("signed bytes");
      const leftoverTempFiles = (await readdir(dir)).filter(
        (name) => name !== "asset.png",
      );
      expect(leftoverTempFiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a failing c2patool leaves the asset untouched and no temp files behind", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "c2pa-test-"));
    try {
      const assetPath = path.join(dir, "asset.png");
      await writeFile(assetPath, "original bytes");

      const tool = {
        signC2pa: async () => {
          throw new Error("c2patool exploded");
        },
      };

      const warnings: string[] = [];
      await signAssetWithC2pa(
        tool,
        assetPath,
        { certPath: "/certs/cert.pem", keyPath: "/certs/key.pem" },
        { modelName: "LTX 2.5", siteTitle: "My Studio", generationId: "gen-1" },
        (message) => warnings.push(message),
      );

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("c2patool exploded");
      expect(await readFile(assetPath, "utf-8")).toBe("original bytes");
      const leftoverTempFiles = (await readdir(dir)).filter(
        (name) => name !== "asset.png",
      );
      expect(leftoverTempFiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
