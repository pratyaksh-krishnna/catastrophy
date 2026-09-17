import { readFileSync } from "node:fs";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareLocations, readExifLocation, stripExif } from "./exif.js";

const geotagged = () =>
  Buffer.from(
    readFileSync("src/media/__fixtures__/geotagged.jpg.base64", "utf8").trim(),
    "base64",
  );

describe("exif", () => {
  it("reads GPS out of a geotagged photo", async () => {
    const location = await readExifLocation(geotagged());
    expect(location).not.toBeNull();
    expect(location!.lat).toBeCloseTo(28.5677, 3);
    expect(location!.lon).toBeCloseTo(77.2432, 3);
  });

  it("returns null rather than throwing when GPS was stripped", async () => {
    const stripped = await stripExif(geotagged());
    expect(await readExifLocation(stripped)).toBeNull();
  });

  it("produces a non-empty public derivative with no EXIF block — ADR-0002", async () => {
    const original = geotagged();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const stripped = await stripExif(original);
    expect(stripped.byteLength).toBeGreaterThan(0);
    expect((await sharp(stripped).metadata()).exif).toBeUndefined();
    expect(await readExifLocation(stripped)).toBeNull();
  });

  it("rejects out-of-range EXIF coordinates", async () => {
    const invalid = geotagged();
    const exifMarker = invalid.indexOf(Buffer.from("Exif\0\0", "binary"));
    expect(exifMarker).toBeGreaterThan(0);

    // This fixture uses a little-endian TIFF payload; latitude degrees are the
    // first rational at TIFF offset 80. Change 28 degrees to invalid 91.
    invalid.writeUInt32LE(91, exifMarker + 6 + 80);
    await expect(readExifLocation(invalid)).resolves.toBeNull();
  });

  it("treats malformed image data like absent EXIF", async () => {
    await expect(readExifLocation(Buffer.from("not an image"))).resolves.toBeNull();
  });

  it("calls close readings agreement", () => {
    expect(
      compareLocations(
        { lat: 28.5677, lon: 77.2432 },
        { lat: 28.56775, lon: 77.24325 },
      ),
    ).toBe("agree");
  });

  it("calls distant readings disagreement", () => {
    expect(
      compareLocations(
        { lat: 28.5677, lon: 77.2432 },
        { lat: 28.7, lon: 77.1 },
      ),
    ).toBe("disagree");
  });

  it("calls a missing EXIF reading unknown, never a rejection", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, null)).toBe("unknown");
  });
});
