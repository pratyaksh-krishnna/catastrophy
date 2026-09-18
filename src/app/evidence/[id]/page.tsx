import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../api/reporter";
import { approvedBuildingForEvidence, reporterEvidenceStatus } from "../../../api/evidence-status";
import { StatusRefresh } from "./status-refresh";

export const metadata: Metadata = { title: "Evidence status" };

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const reporterId = verifyReporterSession((await cookies()).get(REPORTER_COOKIE)?.value);
  const { id } = await params;
  const evidence = reporterId ? await reporterEvidenceStatus(reporterId, id) : null;
  if (!evidence) notFound();
  const approvedBuildingId = await approvedBuildingForEvidence(reporterId!, id);

  return (
    <main id="main-content" className="assessment-shell assessment-shell--empty">
      <div className="grain" aria-hidden="true" />
      <section className="pending-card reveal reveal--one">
        <div className="eyebrow eyebrow--dark"><span /> Private Evidence status</div>
        <h1>{evidence.status === "assessed" ? "Your Evidence is assessed." : "Your Evidence is in."}</h1>
        <p>{evidence.status === "assessed"
          ? "Your observation has been included in the Building assessment. Exact details are available only to approved residents and Office-bearers."
          : "Classification and corroboration are in progress. This page will update automatically."}</p>
        <p>Received {new Date(evidence.receivedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.</p>
        <p className="receipt-id">Receipt {evidence.evidenceId}</p>
        {!approvedBuildingId && <p>A reviewer can grant resident access after verifying your standing. Share this receipt id with them.</p>}
        {approvedBuildingId && evidence.status === "assessed" && (
          <Link className="secondary-cta" href={`/building/${approvedBuildingId}`}>View Building Assessment</Link>
        )}
        <Link className="status-home-link" href="/">Return to the public map</Link>
      </section>
      {evidence.status === "processing" && <StatusRefresh />}
    </main>
  );
}
