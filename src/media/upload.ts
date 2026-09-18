import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
