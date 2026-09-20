import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../../../api/reporter";
import { getAssessment } from "../../../../../db/assessments";
import { db } from "../../../../../db/client";
import { officeBearerForBuilding } from "../../detail";
import { sendEscalation } from "../../../../../escalation/send";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await context.params;
  const reporterId = verifyReporterSession(request.cookies.get(REPORTER_COOKIE)?.value);
  if (!UUID.test(id) || !reporterId || !(await officeBearerForBuilding(reporterId, id))) {
    return NextResponse.json({ error: "Building not found" }, { status: 404 });
  }

  const assessment = await getAssessment(id);
  if (!assessment || !["escalated", "critical"].includes(assessment.alertLevel)) {
    return NextResponse.json({ error: "Assessment is not ready for escalation" }, { status: 409 });
  }
  const building = await db.execute(sql`SELECT address_text FROM buildings WHERE id = ${id}`);
  if (!building.rows[0]) return NextResponse.json({ error: "Building not found" }, { status: 404 });

  try {
    const ids = await sendEscalation({
      buildingId: id,
      addressText: building.rows[0].address_text as string,
      assessment,
    });
    return NextResponse.json({ escalationIds: ids, status: "sent" }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Escalation delivery failed", error);
    return NextResponse.json({ error: "Escalation could not be delivered" }, { status: 503 });
  }
}
