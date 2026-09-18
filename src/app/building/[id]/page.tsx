import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORTER_COOKIE, verifyReporterSession } from "../../../api/reporter";
import { buildingDetail, officeBearerForBuilding, reporterCanAccessBuilding } from "../../api/building/detail";
import { EscalateButton } from "./escalate-button";

export const metadata: Metadata = { title: "Building Assessment" };

const ACTION_COPY = {
  monitor: "Problems are on record. Continue documenting visible changes.",
  act: "Arrange a professional structural review and raise this with your Society.",
  escalated: "The Assessment warrants escalation. Seek a professional structural review promptly.",
  critical: "The Assessment warrants urgent authority attention and an immediate professional structural review.",
} as const;

export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const reporterId = verifyReporterSession(cookieStore.get(REPORTER_COOKIE)?.value);
  if (!reporterId || !(await reporterCanAccessBuilding(reporterId, id))) notFound();
  const detail = await buildingDetail(reporterId, id);

  if (!detail) {
    return (
      <main id="main-content" className="assessment-shell assessment-shell--empty">
        <div className="grain" aria-hidden="true" />
        <section className="pending-card reveal reveal--one">
          <div className="eyebrow eyebrow--dark"><span /> Assessment in progress</div>
          <h1>The Evidence is in.<br /><em>The picture is forming.</em></h1>
          <p>Classification and corroboration happen away from the request path. Check back shortly.</p>
          <Link className="secondary-cta" href="/">Return to the public map</Link>
        </section>
      </main>
    );
  }

  return (
    <main id="main-content" className={`assessment-shell assessment-shell--${detail.alertLevel}`}>
      <div className="grain" aria-hidden="true" />
      <nav className="floating-nav floating-nav--dark" aria-label="Primary navigation">
        <Link className="wordmark" href="/"><span className="wordmark-glyph" aria-hidden="true">C</span><span>Catastrophy</span></Link>
        <span className="nav-divider" aria-hidden="true" />
        <Link className="nav-action" href="/report">Add Evidence</Link>
      </nav>

      <section className="assessment-grid">
        <header className="assessment-summary reveal reveal--one">
          <div className="level-chip"><i aria-hidden="true" /> {detail.alertLevel}</div>
          <p className="assessment-label">Current Alert Level</p>
          <h1>{detail.addressText}</h1>
          <p className="assessment-action">{ACTION_COPY[detail.alertLevel]}</p>
          <div className="score-privacy"><span aria-hidden="true">⌁</span> Alert Level is shown. Internal Score never is.</div>
        </header>

        <div className="assessment-bezel reveal reveal--two">
          <article className="assessment-card">
            <div className="assessment-card-head">
              <div><span className="form-index">Latest Assessment</span><h2>What is on record</h2></div>
              <span className="hazard-count">{detail.hazards.length} {detail.hazards.length === 1 ? "Hazard" : "Hazards"}</span>
            </div>
            <p className="narrative">{detail.narrative}</p>
            {detail.hazards.length > 0 ? (
              <ol className="hazard-list">
                {detail.hazards.map((hazard, index) => (
                  <li key={`${hazard.label}-${index}`}>
                    <span className="hazard-number">{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{hazard.label}</strong><small>{hazard.support}</small></div>
                  </li>
                ))}
              </ol>
            ) : <p className="empty-hazards">No open Hazards are included in this Assessment.</p>}
            {detail.escalations.length > 0 && (
              <section className="escalation-status" aria-label="Authority response status">
                <h3>Authority response</h3>
                <ul>{detail.escalations.map((escalation) => (
                  <li key={escalation.authority}>
                    <strong>{escalation.authority.toUpperCase()}</strong>: {escalation.status}
                    {escalation.externalTicket && <> · Ticket {escalation.externalTicket}</>}
                  </li>
                ))}</ul>
              </section>
            )}
            <div className="assessment-foot">
              <p>Assessment changes replace the previous version wholesale, keeping the next action clear.</p>
              <Link className="secondary-cta" href="/report">Add fresh Evidence</Link>
            </div>
            {(await officeBearerForBuilding(reporterId, id)) && detail.needsEscalation && (detail.alertLevel === "escalated" || detail.alertLevel === "critical") && (
              <EscalateButton buildingId={id} />
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
