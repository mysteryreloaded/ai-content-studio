// c2pa.ts's pure helpers (issue #75's AC: arm64 and unsupported formats
// get the "AI-generated" tag only), plus signAssetWithC2pa's temp-file
// behaviour against a fake c2patool.

import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildManifest,
  c2paSupportsArch,
  c2paSupportsFormat,
  loadC2paSignerConfig,
  resolveC2paAlg,
  signAssetWithC2pa,
} from "./c2pa.js";

const SIGNER = {
  certPath: "/certs/cert.pem",
  keyPath: "/certs/key.pem",
  alg: "es256" as const,
};

function ecKeyPem(namedCurve: string): string {
  return generateKeyPairSync("ec", {
    namedCurve,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
}

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
    const manifest = buildManifest(SIGNER, {
      modelName: "LTX 2.5",
      siteTitle: "My Studio",
      generationId: "gen-1",
    }) as {
      title: string;
      alg: string;
      sign_cert: string;
      private_key: string;
      ta_url?: string;
      assertions: Array<{ label: string; data: unknown }>;
    };

    expect(manifest.title).toBe("My Studio");
    expect(manifest.alg).toBe("es256");
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
      { ...SIGNER, timestampUrl: "http://timestamp.example.com" },
      { modelName: "LTX 2.5", siteTitle: "My Studio", generationId: "gen-1" },
    ) as { ta_url?: string };
    expect(manifest.ta_url).toBe("http://timestamp.example.com");
  });

  test.each([
    ["es256" as const],
    ["es384" as const],
    ["es512" as const],
    ["ps256" as const],
    ["ed25519" as const],
  ])("includes alg %s as given by the signer config", (alg) => {
    const manifest = buildManifest(
      { ...SIGNER, alg },
      { modelName: "LTX 2.5", siteTitle: "My Studio", generationId: "gen-1" },
    ) as { alg: string };
    expect(manifest.alg).toBe(alg);
  });
});

describe("resolveC2paAlg", () => {
  test("EC P-256 (prime256v1) resolves to es256", () => {
    expect(resolveC2paAlg(ecKeyPem("P-256"))).toBe("es256");
  });

  test("EC P-384 (secp384r1) resolves to es384", () => {
    expect(resolveC2paAlg(ecKeyPem("P-384"))).toBe("es384");
  });

  test("EC P-521 (secp521r1) resolves to es512", () => {
    expect(resolveC2paAlg(ecKeyPem("P-521"))).toBe("es512");
  });

  test("RSA resolves to ps256", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(resolveC2paAlg(privateKey)).toBe("ps256");
  });

  test("Ed25519 resolves to ed25519", () => {
    const { privateKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(resolveC2paAlg(privateKey)).toBe("ed25519");
  });

  test("an unsupported EC curve throws a clear error", () => {
    expect(() => resolveC2paAlg(ecKeyPem("secp224r1"))).toThrow(
      /unsupported EC curve "secp224r1"/,
    );
  });

  test("unreadable bytes throw a clear error", () => {
    expect(() => resolveC2paAlg("not a PEM key")).toThrow(
      /not a readable PEM private key/,
    );
  });
});

describe("loadC2paSignerConfig", () => {
  test("resolves relative cert/key paths to absolute ones (c2patool resolves them against the manifest's own folder)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "c2pa-test-"));
    try {
      const keyPath = path.join(dir, "key.pem");
      await writeFile(keyPath, ecKeyPem("P-256"));
      const certPath = path.join(dir, "cert.pem");
      await writeFile(
        certPath,
        "not a real cert, just needs to exist as a path",
      );

      const relativeKeyPath = path.relative(process.cwd(), keyPath);
      const relativeCertPath = path.relative(process.cwd(), certPath);
      const config = loadC2paSignerConfig(
        relativeCertPath,
        relativeKeyPath,
        undefined,
      );

      expect(config.certPath).toBe(path.resolve(relativeCertPath));
      expect(config.keyPath).toBe(path.resolve(relativeKeyPath));
      expect(path.isAbsolute(config.certPath)).toBe(true);
      expect(path.isAbsolute(config.keyPath)).toBe(true);
      expect(config.alg).toBe("es256");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable key path throws a clear error at startup rather than warning per Asset", () => {
    expect(() =>
      loadC2paSignerConfig("/certs/cert.pem", "/does/not/exist.key", undefined),
    ).toThrow(/C2PA_KEY_PATH/);
  });

  test("an unsupported key type throws a clear error at startup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "c2pa-test-"));
    try {
      const keyPath = path.join(dir, "key.pem");
      await writeFile(keyPath, ecKeyPem("secp224r1"));
      expect(() =>
        loadC2paSignerConfig("/certs/cert.pem", keyPath, undefined),
      ).toThrow(/unsupported EC curve/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
        SIGNER,
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
        SIGNER,
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
