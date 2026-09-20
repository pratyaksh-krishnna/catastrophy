import { NextResponse, type NextRequest } from "next/server";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../../api/reporter";
import { reporterEvidenceStatus } from "../../../../api/evidence-status";
import { dispatchPendingRegenerations } from "../../../../pipeline/regenerate";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const reporterId = verifyReporterSession(request.cookies.get(REPORTER_COOKIE)?.value);
  const { id } = await context.params;
  const status = reporterId ? await reporterEvidenceStatus(reporterId, id) : null;
  if (!status) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  void dispatchPendingRegenerations().catch((error: unknown) => {
    console.error("Assessment regeneration retry failed", error);
  });
  return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
}
