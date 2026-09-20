import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../api/reporter";

const submitted = vi.hoisted(() => vi.fn());
vi.mock("../../../api/submit-evidence", () => ({
  EvidenceInputError: class EvidenceInputError extends Error {},
  submitEvidence: submitted,
}));

import { POST } from "./route";

const reporterId = "d4ae9141-5119-4db0-a870-861914a9e88b";
const buildingId = "b61cd214-cd62-4d86-9c0c-a569c72bf50b";
const evidenceId = "965c663b-ea9b-4fd6-9eb2-dd4b9611b6f3";

function request(extra: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    addressText: "C-14, Lajpat Nagar II",
    note: "A diagonal crack is visible.",
    lat: "28.58",
    lon: "77.22",
    buildingLat: "28.58",
    buildingLon: "77.22",
    sourceClass: "official_record", // Caller cannot assert this trusted class.
    ...extra,
  })) form.set(key, value);
  return new NextRequest("http://localhost/api/evidence", { method: "POST", body: form });
}

describe("Evidence HTTP boundary", () => {
  beforeEach(() => submitted.mockReset());

  it("returns only the Reporter's receipt and signs the session cookie", async () => {
    submitted.mockResolvedValue({
      evidenceId,
      buildingId,
      reporterId,
      geoAgreement: "agree",
      hazardTypeIds: ["load_bearing_crack"],
      needsLocationConfirmation: false,
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ evidenceId, status: "processing" });
    expect(verifyReporterSession(response.cookies.get(REPORTER_COOKIE)?.value)).toBe(reporterId);
    expect(submitted.mock.calls[0]![0].sourceClass).toBe("resident_account");
  });

  it("requires an explicit retry for a distant Building without minting a Reporter cookie", async () => {
    submitted.mockResolvedValue({
      evidenceId: null,
      buildingId,
      reporterId: null,
      geoAgreement: "unknown",
      hazardTypeIds: [],
      needsLocationConfirmation: true,
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ needsLocationConfirmation: true, buildingId });
    expect(response.cookies.get(REPORTER_COOKIE)).toBeUndefined();
  });
});
