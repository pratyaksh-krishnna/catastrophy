import { NextResponse, type NextRequest } from "next/server";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../../api/reporter";
import { buildingDetail, reporterCanAccessBuilding } from "../detail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid Building id" }, { status: 400 });

  const reporterId = verifyReporterSession(request.cookies.get(REPORTER_COOKIE)?.value);
  if (!reporterId || !(await reporterCanAccessBuilding(reporterId, id))) {
    // A 404 avoids confirming that a private Building record exists.
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const detail = await buildingDetail(id);
  if (!detail) return NextResponse.json({ error: "Assessment not found" }, { status: 404 });

  return NextResponse.json(detail, {
    // The response contains an exact address and must never enter a shared cache.
    headers: { "Cache-Control": "private, no-store" },
  });
}
