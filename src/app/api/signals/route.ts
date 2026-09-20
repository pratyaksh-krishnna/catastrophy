import { NextResponse } from "next/server";
import { publicSignals } from "../../../api/signals";

export async function GET(request: Request) {
  try {
    const cells = await publicSignals();
    return NextResponse.json(
      { cells },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("Signals query failed", error);
    return NextResponse.json({ error: "Signals unavailable" }, { status: 503 });
  }
}
