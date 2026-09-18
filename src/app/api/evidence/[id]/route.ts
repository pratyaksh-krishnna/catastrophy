import { NextResponse, type NextRequest } from "next/server";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../../api/reporter";
import { reporterEvidenceStatus } from "../../../../api/evidence-status";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const reporterId = verifyReporterSession(request.cookies.get(REPORTER_COOKIE)?.value);
  const { id } = await context.params;
  const status = reporterId ? await reporterEvidenceStatus(reporterId, id) : null;
  return status
    ? NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } })
    : NextResponse.json({ error: "Evidence not found" }, { status: 404 });
}
