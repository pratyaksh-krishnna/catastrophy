import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { storeEvidenceMedia } from "./upload.js";

describe("storeEvidenceMedia", () => {
  it("keeps development originals private and strips GPS from the public copy", async () => {
    const mediaDir = await mkdtemp(join(tmpdir(), "catastrophy-media-"));
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_MEDIA_DIR", mediaDir);
    vi.stubEnv("S3_BUCKET", "");

    try {
      const original = Buffer.from(
        readFileSync("src/media/__fixtures__/geotagged.jpg.base64", "utf8").trim(),
        "base64",
      );
      const keys = await storeEvidenceMedia(original, "building/evidence", "image/jpeg");
      expect(keys).toEqual({
        originalKey: "original/building/evidence.jpg",
        publicKey: "public/building/evidence.jpg",
      });

      const storedOriginal = await readFile(join(mediaDir, keys.originalKey));
      const storedPublic = await readFile(join(mediaDir, keys.publicKey));
      expect(storedOriginal).toEqual(original);
      expect((await sharp(storedOriginal).metadata()).exif).toBeDefined();
      expect((await sharp(storedPublic).metadata()).exif).toBeUndefined();
      expect((await stat(join(mediaDir, keys.originalKey))).mode & 0o777).toBe(0o600);
      expect((await stat(join(mediaDir, keys.publicKey))).mode & 0o777).toBe(0o600);
    } finally {
      vi.unstubAllEnvs();
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});
