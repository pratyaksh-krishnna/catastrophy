"use client";

import { useState } from "react";

interface DemoMailPreviewProps {
  addressText: string;
  alertLevel: string;
  narrative: string;
  hazards: Array<{ label: string; support: string }>;
  authorities: string[];
  evidenceId: string;
}

export function DemoMailPreview({
  addressText,
  alertLevel,
  narrative,
  hazards,
  authorities,
  evidenceId,
}: DemoMailPreviewProps) {
  const [sent, setSent] = useState(false);

  return (
    <aside className="demo-mail-card reveal reveal--two" aria-labelledby="demo-mail-heading">
      <div className="demo-mail-topline">
        <span>Demo communication</span>
        <span className="demo-mail-draft">{sent ? "SIMULATED SENT" : "PREVIEW ONLY"}</span>
      </div>
      <h2 id="demo-mail-heading">Authority email preview</h2>
      <p className="demo-mail-intro">A sample complaint assembled from the current Assessment. This page never sends an email.</p>

      <dl className="demo-mail-meta">
        <div><dt>To</dt><dd>{authorities.join(" · ")} <span>demo inboxes</span></dd></div>
        <div><dt>Subject</dt><dd>[DEMO · {alertLevel.toUpperCase()}] Structural safety review — {addressText}</dd></div>
        <div><dt>Reference</dt><dd>Evidence {evidenceId.slice(0, 8).toUpperCase()}</dd></div>
      </dl>

      <div className="demo-mail-body">
        <p>To {authorities.join(" and ")},</p>
        <p>Please review the following concerns recorded for {addressText}. This is a fictional demonstration and does not describe a real incident.</p>
        <ol>
          {hazards.map((hazard) => (
            <li key={hazard.label}><strong>{hazard.label}</strong><span>{hazard.support}</span></li>
          ))}
        </ol>
        <p><strong>Assessment summary</strong><br />{narrative}</p>
        <p>Please quote the reference above in any follow-up.</p>
      </div>

      <div className="demo-mail-actions">
        <button type="button" onClick={() => setSent(true)} disabled={sent}>
          {sent ? "Demo send complete" : "Send demo email"}
          <span aria-hidden="true">↗</span>
        </button>
        <p role="status" aria-live="polite">
          {sent ? "Simulation complete. No email was delivered." : "Simulation only. No authority will receive this email."}
        </p>
      </div>
    </aside>
  );
}
