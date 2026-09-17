import Link from "next/link";
import { PublicHeatmap } from "./public-heatmap";

function ArrowMark() {
  return (
    <span className="button-orbit" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M9 7h8v8" /></svg>
    </span>
  );
}

export default function Home() {
  return (
    <main id="main-content" className="landing-shell">
      <div className="grain" aria-hidden="true" />
      <nav className="floating-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/" aria-label="Catastrophy home">
          <span className="wordmark-glyph" aria-hidden="true">C</span>
          <span>Catastrophy</span>
        </Link>
        <span className="nav-divider" aria-hidden="true" />
        <Link className="nav-action" href="/report">Submit evidence</Link>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy reveal reveal--one">
          <div className="eyebrow"><span /> Delhi building safety</div>
          <h1>See the signal.<br /><em>Protect the address.</em></h1>
          <p className="hero-lede">
            Residents turn first-hand Evidence into a calm, structured safety picture—so serious
            Hazards reach the people who can act, without putting anyone’s home on a public pin.
          </p>
          <div className="hero-actions">
            <Link className="primary-cta group" href="/report">
              Share what you saw
              <ArrowMark />
            </Link>
            <a className="text-link" href="#privacy">How privacy works <span aria-hidden="true">↓</span></a>
          </div>
          <dl className="hero-proof" aria-label="How Catastrophy works">
            <div><dt>01</dt><dd>Evidence-led</dd></div>
            <div><dt>02</dt><dd>Human-grounded</dd></div>
            <div><dt>03</dt><dd>Privacy by design</dd></div>
          </dl>
        </div>

        <div className="map-bezel reveal reveal--two">
          <div className="map-core"><PublicHeatmap /></div>
        </div>
      </section>

      <section id="privacy" className="privacy-strip reveal reveal--three">
        <p className="section-kicker">A safer public record</p>
        <p className="privacy-statement">
          The map reveals patterns across a neighbourhood, <em>not which Building is involved.</em>
        </p>
        <div className="privacy-rule" />
        <p className="privacy-detail">
          A cell appears only after enough distinct Buildings contribute to it. We never publish
          exact locations, addresses, underlying counts, or internal Scores.
        </p>
      </section>
    </main>
  );
}
