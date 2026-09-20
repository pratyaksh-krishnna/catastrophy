"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { BuildingPin } from "./building-pin";

type SubmitState = "idle" | "locating" | "submitting" | "success" | "confirm" | "error";

interface EvidenceResponse {
  buildingId?: string;
  evidenceId?: string;
  needsLocationConfirmation?: boolean;
  error?: string;
}

function ArrowMark() {
  return (
    <span className="button-orbit button-orbit--light" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M9 7h8v8" /></svg>
    </span>
  );
}

export default function ReportPage() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [pendingBuildingId, setPendingBuildingId] = useState<string | null>(null);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "locating" || state === "submitting") return;
    const formElement = event.currentTarget;

    try {
      if (!pin) throw new Error("Pin the Building on the map before submitting.");
      if (!("geolocation" in navigator)) throw new Error("This browser cannot share a location.");
      setState("locating");
      setMessage("Locating you securely…");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 30_000,
        });
      });

      const form = new FormData(formElement);
      const file = form.get("media");
      form.set("lat", String(position.coords.latitude));
      form.set("lon", String(position.coords.longitude));
      form.set("buildingLat", String(pin.lat));
      form.set("buildingLon", String(pin.lon));
      // Source Class is intentionally derived again by the server.
      if (pendingBuildingId) {
        form.set("buildingId", pendingBuildingId);
        form.set("confirmLocation", "true");
      }

      setState("submitting");
      setMessage("Protecting the details and recording your Evidence…");
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      const body = await response.json() as EvidenceResponse;
      if (response.status === 409 && body.needsLocationConfirmation && body.buildingId) {
        setPendingBuildingId(body.buildingId);
        setState("confirm");
        setMessage("Your device appears more than 150 m from this Building. Check the address, then press confirm to submit. Nothing has been uploaded yet.");
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "We could not submit this Evidence.");

      setState("success");
      setPendingBuildingId(null);
      setMessage("Evidence received. You can follow its processing status privately.");
      formRef.current?.reset();
      setFileName("");
      if (body.evidenceId) window.location.assign(`/evidence/${body.evidenceId}`);
    } catch (error) {
      setState("error");
      if (typeof GeolocationPositionError !== "undefined" && error instanceof GeolocationPositionError) {
        setMessage("Location access is needed to place this Evidence. Your exact location is never shown publicly.");
      } else {
        setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      }
    }
  }

  const busy = state === "locating" || state === "submitting";

  return (
    <main id="main-content" className="report-shell">
      <div className="grain" aria-hidden="true" />
      <nav className="floating-nav floating-nav--dark" aria-label="Primary navigation">
        <Link className="wordmark" href="/">
          <span className="wordmark-glyph" aria-hidden="true">C</span>
          <span>Catastrophy</span>
        </Link>
        <span className="nav-divider" aria-hidden="true" />
        <Link className="nav-action" href="/">View public map</Link>
      </nav>

      <section className="report-grid">
        <header className="report-intro reveal reveal--one">
          <div className="eyebrow eyebrow--dark"><span /> Private by default</div>
          <h1>Show us what<br /><em>needs attention.</em></h1>
          <p>
            One clear observation can be useful. A photo helps, but it is optional—missing EXIF
            data never causes a rejection.
          </p>
          <ol className="report-steps">
            <li><span>01</span><div><strong>Name the place</strong><small>Use the Building address people recognise.</small></div></li>
            <li><span>02</span><div><strong>Describe only what you saw</strong><small>We infer Hazard Types without changing their Severity.</small></div></li>
            <li><span>03</span><div><strong>Share your device location</strong><small>Used to corroborate—not published as a pin.</small></div></li>
          </ol>
        </header>

        <div className="form-bezel reveal reveal--two">
          <form ref={formRef} className="evidence-form" onSubmit={submit}>
            <div className="form-heading">
              <span className="form-index">Evidence / 001</span>
              <h2>First-hand observation</h2>
              <p>You’ll remain pseudonymous on public surfaces.</p>
            </div>

            <label className="field">
              <span>Building address</span>
              <input name="addressText" autoComplete="street-address" placeholder="e.g. C-14, Lajpat Nagar II" maxLength={300} required onChange={() => setPendingBuildingId(null)} />
            </label>

            <div className="field">
              <span>Pin the Building</span>
              <BuildingPin value={pin} onChange={(point) => { setPin(point); setPendingBuildingId(null); }} />
              <small>{pin ? `Pinned at ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` : "Tap the Building on the map, or use your current location."}</small>
            </div>

            <label className="field">
              <span>What did you observe?</span>
              <textarea name="note" rows={5} placeholder="Describe the crack, lean, exposed reinforcement, blocked exit…" maxLength={2_000} required />
              <small>Facts are more useful than guesses. Avoid names or personal details.</small>
            </label>

            <label className="upload-field">
              <input
                type="file"
                name="media"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
              <span className="upload-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 16V5m0 0L8 9m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
              </span>
              <span><strong>{fileName || "Add a photo"}</strong><small>{fileName ? "Tap to choose a different image" : "JPEG, PNG or WebP · up to 12 MB"}</small></span>
              <span className="upload-plus" aria-hidden="true">+</span>
            </label>

            <button className="submit-button group" type="submit" disabled={busy}>
              <span>{state === "locating" ? "Getting location" : state === "submitting" ? "Recording Evidence" : state === "confirm" ? "Confirm address & submit" : "Submit securely"}</span>
              <ArrowMark />
            </button>

            <p className={`form-status form-status--${state}`} role="status" aria-live="polite">
              {message || "Your original media is retained for authorities; public derivatives have location metadata removed."}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
