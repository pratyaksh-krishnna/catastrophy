import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { stripExif } from "./exif";

const configuredRegion = process.env.AWS_REGION;
const s3 = new S3Client(configuredRegion ? { region: configuredRegion } : {});

function bucket(): string {
  const configured = process.env.S3_BUCKET;
  if (!configured) throw new Error("S3_BUCKET is not set");
  return configured;
}

export interface StoredMedia {
  originalKey: string;
  publicKey: string;
}

async function storeLocalMedia(
  originalKey: string,
  publicKey: string,
  original: Buffer,
  derivative: Buffer,
): Promise<void> {
  const root = resolve(process.env.LOCAL_MEDIA_DIR ?? ".local-media");
  const localPath = (key: string) => {
    const path = resolve(root, key);
    const fromRoot = relative(root, path);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error("Invalid local media key");
    }
    return path;
  };
  const originalPath = localPath(originalKey);
  const publicPath = localPath(publicKey);
  await Promise.all([
    mkdir(dirname(originalPath), { recursive: true, mode: 0o700 }),
    mkdir(dirname(publicPath), { recursive: true, mode: 0o700 }),
  ]);
  await writeFile(originalPath, original, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(publicPath, derivative, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await unlink(originalPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Stores the untouched original for authorities and an EXIF-free derivative
 * for lower-trust audiences. See ADR-0002.
 */
export async function storeEvidenceMedia(
  buf: Buffer,
  keyBase: string,
  originalContentType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<StoredMedia> {
  const extension = originalContentType === "image/png" ? "png" : originalContentType === "image/webp" ? "webp" : "jpg";
  const originalKey = `original/${keyBase}.${extension}`;
  const publicKey = `public/${keyBase}.jpg`;
  const derivative = await stripExif(buf);
  if (process.env.NODE_ENV === "development") {
    await storeLocalMedia(originalKey, publicKey, buf, derivative);
    return { originalKey, publicKey };
  }
  const Bucket = bucket();

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket,
        Key: originalKey,
        Body: buf,
        ContentType: originalContentType,
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket,
        Key: publicKey,
        Body: derivative,
        ContentType: "image/jpeg",
      }),
    ),
  ]);

  return { originalKey, publicKey };
}
