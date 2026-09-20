"use client";

import { useState } from "react";

export function EscalateButton({ buildingId }: { buildingId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function escalate() {
    setState("sending");
    try {
      const response = await fetch(`/api/building/${buildingId}/escalate`, { method: "POST" });
      if (!response.ok) throw new Error("Delivery failed");
      setState("sent");
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="escalation-action">
      <button type="button" className="submit-button" onClick={escalate} disabled={state === "sending" || state === "sent"}>
        {state === "sending" ? "Sending to authorities…" : state === "sent" ? "Sent to authorities" : "Escalate to authorities"}
      </button>
      {state === "error" && <p role="alert">Delivery failed. Please try again.</p>}
    </div>
  );
}
