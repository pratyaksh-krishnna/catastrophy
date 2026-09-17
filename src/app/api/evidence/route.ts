import { NextResponse, type NextRequest } from "next/server";
import {
  EvidenceInputError,
  submitEvidence,
  type SubmitEvidenceInput,
} from "../../../api/submit-evidence";
import type { SourceClass } from "../../../domain/confidence";
import { REPORTER_COOKIE } from "../../../api/reporter";

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const ACCEPTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function requiredText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || !value.trim()) throw new EvidenceInputError(`${key} is required`);
  return value.trim();
}

function requiredNumber(form: FormData, key: string): number {
  const value = Number(requiredText(form, key));
  if (!Number.isFinite(value)) throw new EvidenceInputError(`${key} must be a finite number`);
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const candidate = form.get("media");
    const file = candidate instanceof File && candidate.size > 0 ? candidate : undefined;
    if (file && file.size > MAX_MEDIA_BYTES) throw new EvidenceInputError("Photo must be 12 MB or smaller");
    if (file && !ACCEPTED_MEDIA_TYPES.has(file.type)) {
      throw new EvidenceInputError("Photo must be JPEG, PNG, or WebP");
    }

    const media = file ? Buffer.from(await file.arrayBuffer()) : undefined;
    // Public callers cannot self-assert a trusted Source Class.
    const sourceClass: SourceClass = file ? "resident_photo" : "resident_account";
    const optionalBuildingId = form.get("buildingId");
    const input: SubmitEvidenceInput = {
      reporterId: request.cookies.get(REPORTER_COOKIE)?.value,
      addressText: requiredText(form, "addressText"),
      note: requiredText(form, "note"),
      sourceClass,
      deviceLocation: { lat: requiredNumber(form, "lat"), lon: requiredNumber(form, "lon") },
      capturedAt: new Date(),
      ...(typeof optionalBuildingId === "string" && optionalBuildingId.trim()
        ? { buildingId: optionalBuildingId.trim() }
        : {}),
      ...(media ? { media } : {}),
      confirmLocation: form.get("confirmLocation") === "true",
    };

    const result = await submitEvidence(input);
    const { reporterId, ...publicResult } = result;
    const response = NextResponse.json(publicResult, {
      status: result.needsLocationConfirmation ? 409 : 201,
    });
    if (reporterId) {
      response.cookies.set(REPORTER_COOKIE, reporterId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    return response;
  } catch (error) {
    if (error instanceof EvidenceInputError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Evidence submission failed", error);
    return NextResponse.json({ error: "Evidence could not be submitted" }, { status: 500 });
  }
}
