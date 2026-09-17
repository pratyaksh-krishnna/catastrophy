### Task 7: EXIF handling and media upload

**Files:**
- Create: `src/media/exif.ts`, `src/media/upload.ts`
- Test: `src/media/exif.test.ts`

**Interfaces:**
- Consumes: `GeoAgreement` (Task 2)
- Produces: `readExifLocation(buf)`, `stripExif(buf)`, `compareLocations(device, exif)`, `EXIF_AGREEMENT_RADIUS_M`, `storeEvidenceMedia(buf, key)`

- [ ] **Step 1: Write the failing test**

Create `src/media/exif.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readExifLocation, stripExif, compareLocations } from "./exif.js";
import { readFileSync } from "node:fs";

// Fixture: any JPEG with GPS EXIF. Generate once with:
//   exiftool -GPSLatitude=28.5677 -GPSLatitudeRef=N -GPSLongitude=77.2432 \
//            -GPSLongitudeRef=E src/media/__fixtures__/geotagged.jpg
const geotagged = () => readFileSync("src/media/__fixtures__/geotagged.jpg");

describe("exif", () => {
  it("reads GPS out of a geotagged photo", async () => {
    const loc = await readExifLocation(geotagged());
    expect(loc).not.toBeNull();
    expect(loc!.lat).toBeCloseTo(28.5677, 3);
  });

  it("returns null rather than throwing when GPS was stripped by the sharing app", async () => {
    const stripped = await stripExif(geotagged());
    expect(await readExifLocation(stripped)).toBeNull();
  });

  it("produces a derivative with no GPS — ADR-0002", async () => {
    const stripped = await stripExif(geotagged());
    expect(await readExifLocation(stripped)).toBeNull();
    expect(stripped.byteLength).toBeGreaterThan(0);
  });

  it("calls close readings agreement", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, { lat: 28.56775, lon: 77.24325 })).toBe("agree");
  });

  it("calls distant readings disagreement", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, { lat: 28.70, lon: 77.10 })).toBe("disagree");
  });

  it("calls a missing EXIF reading unknown, never a rejection", () => {
    expect(compareLocations({ lat: 28.5677, lon: 77.2432 }, null)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/media/exif.test.ts`
Expected: FAIL — cannot resolve `./exif.js`

- [ ] **Step 3: Write the implementation**

```bash
npm i exifr sharp @aws-sdk/client-s3
mkdir -p src/media/__fixtures__
```

Create `src/media/exif.ts`:

```typescript
import exifr from "exifr";
import sharp from "sharp";
import type { GeoAgreement } from "../domain/confidence.js";

export interface LatLon { lat: number; lon: number; }

/** Device fix and EXIF fix within this distance corroborate each other. */
export const EXIF_AGREEMENT_RADIUS_M = 100;

export async function readExifLocation(buf: Buffer | Uint8Array): Promise<LatLon | null> {
  try {
    const gps = await exifr.gps(buf);
    if (!gps || typeof gps.latitude !== "number" || typeof gps.longitude !== "number") return null;
    return { lat: gps.latitude, lon: gps.longitude };
  } catch {
    // Most real uploads arrive with EXIF already stripped by the sharing app.
    // That is normal and never a reason to reject the upload.
    return null;
  }
}

/** The derivative served below the resident tier. The original keeps its metadata. */
export async function stripExif(buf: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(buf).rotate().toBuffer();
}

function haversineM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function compareLocations(device: LatLon, exif: LatLon | null): GeoAgreement {
  if (!exif) return "unknown";
  return haversineM(device, exif) <= EXIF_AGREEMENT_RADIUS_M ? "agree" : "disagree";
}
```

Create `src/media/upload.ts`:

```typescript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { stripExif } from "./exif.js";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const bucket = () => {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
};

export interface StoredMedia { originalKey: string; publicKey: string; }

/**
 * Stores the untouched original — its metadata is part of what makes it evidence
 * to an authority — alongside an EXIF-stripped derivative for anyone below the
 * resident tier. ADR-0002.
 */
export async function storeEvidenceMedia(buf: Buffer, keyBase: string): Promise<StoredMedia> {
  const originalKey = `original/${keyBase}`;
  const publicKey = `public/${keyBase}`;
  const stripped = await stripExif(buf);

  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: bucket(), Key: originalKey, Body: buf, ContentType: "image/jpeg" })),
    s3.send(new PutObjectCommand({ Bucket: bucket(), Key: publicKey, Body: stripped, ContentType: "image/jpeg" })),
  ]);

  return { originalKey, publicKey };
}
```

- [ ] **Step 4: Create the fixture**

```bash
npx sharp-cli -i /dev/null -o src/media/__fixtures__/geotagged.jpg 2>/dev/null || \
  node -e "require('sharp')({create:{width:64,height:64,channels:3,background:'#888'}}).jpeg().toFile('src/media/__fixtures__/geotagged.jpg')"
exiftool -overwrite_original -GPSLatitude=28.5677 -GPSLatitudeRef=N \
  -GPSLongitude=77.2432 -GPSLongitudeRef=E src/media/__fixtures__/geotagged.jpg
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/media/exif.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/media package.json
git commit -m "feat: read exif gps, strip derivatives, corroborate device fix"
```

---

