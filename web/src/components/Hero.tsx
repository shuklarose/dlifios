import EuRegulatoryGlobe from "./EuRegulatoryGlobe";

const CHECKS = [
  "Cited to the article, linked to the official text",
  'Says "I do not know" rather than guessing',
  "New acts ingested automatically each day",
];

export default function Hero() {
  return (
    <div className="hero-grid pad" id="top">
      <div className="hero-copy">
        <span className="pill">
          <span className="dot" /> GDPR &amp; the EU AI Act
        </span>

        <h1>
          Know the Law.<span className="ahead">Cite the Source.</span>
        </h1>

        <p className="hero-sub">
          Grounded answers on EU data-protection law. Every claim is cited to an article and
          linked to the official text, and when the law does not cover your question, DlíFios
          says so instead of guessing.
        </p>

        <ul className="checks">
          {CHECKS.map((text) => (
            <li key={text}>
              <span className="tick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 5 5L20 7" />
                </svg>
              </span>
              {text}
            </li>
          ))}
        </ul>

        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href="#ask">
            Try the Q&amp;A Tool
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
        </div>
      </div>

      <div className="globe-wrap">
        <EuRegulatoryGlobe size="100%" />
      </div>
    </div>
  );
}
