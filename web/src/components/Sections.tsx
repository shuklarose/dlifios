const FEATURES = [
  {
    title: "Grounded in official text",
    body: "Answers are built only from passages retrieved out of the acts themselves, fetched from the EU's own publication service.",
    icon: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </>
    ),
  },
  {
    title: "Cited to the article",
    body: "Each claim names the act and article it came from, linked to the official text on EUR-Lex so you can check it yourself.",
    icon: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" />
      </>
    ),
  },
  {
    title: "Refuses when it cannot cite",
    body: "If the retrieved law does not answer the question, it says so. No invented article numbers, and no citations under a non-answer.",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </>
    ),
  },
  {
    title: "Grows on its own",
    body: "A daily job queries the EU's SPARQL endpoint for newly published data-protection acts and ingests them without anyone intervening.",
    icon: (
      <>
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
      </>
    ),
  },
];

const COVERAGE = [
  {
    act: "GDPR",
    celex: "32016R0679",
    name: "Regulation (EU) 2016/679 on the protection of natural persons with regard to the processing of personal data",
    articles: 99,
    passages: 205,
  },
  {
    act: "EU AI Act",
    celex: "32024R1689",
    name: "Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence",
    articles: 113,
    passages: 324,
  },
  {
    act: "Commission Decision",
    celex: "32026D0713",
    name: "Decision (EU) 2026/713, added automatically by the daily monitor when it was published",
    articles: 2,
    passages: 2,
  },
];

const EU_STARS: Array<[number, number]> = [
  [12, 4.2], [15.9, 5.2], [18.8, 8.1], [19.8, 12], [18.8, 15.9], [15.9, 18.8],
  [12, 19.8], [8.1, 18.8], [5.2, 15.9], [4.2, 12], [5.2, 8.1], [8.1, 5.2],
];

const eurLex = (celex: string) =>
  `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=${encodeURIComponent(`CELEX:${celex}`)}`;

export function TrustBar() {
  return (
    <section className="trustbar">
      <div className="pad">
        <div className="label">Trusted legal intelligence from official EU sources</div>
        <div className="logos">
          <span className="logo">
            <svg className="lmark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="11" fill="#1a3aa8" />
              <g fill="#ffd617">
                {EU_STARS.map(([cx, cy]) => (
                  <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" />
                ))}
              </g>
            </svg>
            EUR-Lex
          </span>
          {/* Curia was listed here, but the corpus holds no case law: claiming a
              source we never query is the failure this product exists to catch. */}
          <span className="logo">
            <svg className="lmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a9 9 0 0 1 9 9v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 9-9z" />
              <path d="M8 12h8" />
              <path d="M8 16h5" />
            </svg>
            EDPB
          </span>
          <span className="logo">
            <span className="oj-badge">OJ</span> Official Journal
          </span>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <section className="section pad" id="what">
      <div className="section-head">
        <svg className="leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6" />
        </svg>
        <h2>What is DlíFios?</h2>
        <p>
          A question-answering system for EU data-protection law that is built so it cannot answer
          from memory. Every response is assembled from the legal text it retrieved, and cited back
          to it.
        </p>
      </div>

      <div className="features">
        {FEATURES.map((f) => (
          <article className="feature" key={f.title}>
            <div className="ficon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {f.icon}
              </svg>
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Coverage() {
  return (
    <section className="section coverage-wrap pad" id="trust">
      <div className="section-head">
        <h2>What DlíFios covers</h2>
        <p>The whole corpus, in the open. Answers can only ever come from these texts.</p>
      </div>

      <div className="cov-grid">
        {COVERAGE.map((c) => (
          <a className="cov-card" key={c.celex} href={eurLex(c.celex)} target="_blank" rel="noopener noreferrer">
            <div className="cov-head">
              <span className="cov-act">{c.act}</span>
              <span className="cov-celex">{c.celex}</span>
            </div>
            <p className="cov-name">{c.name}</p>
            <div className="cov-stats">
              <b>{c.articles}</b> articles indexed <span>·</span> <b>{c.passages}</b> passages
            </div>
          </a>
        ))}
      </div>

      {/* Stating the gap is the point. A tool that hides its limits is the thing
          this product is a reaction to. */}
      <div className="cov-note">
        <span className="cov-note-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </span>
        <p>
          <b>Not covered yet.</b> There is no case law in the corpus, so DlíFios cannot answer
          questions about CJEU judgments and will tell you so rather than guess. National
          implementing laws and EDPB guidance are not indexed either, though new guidance does feed
          the weekly digest.
        </p>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid pad">
        <div>
          <div className="brand">
            <img className="brand-mark" src="/assets/logo.png" alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
            DlíFios
          </div>
          <p className="footer-about">Grounded, cited answers on EU data-protection law.</p>
        </div>
        {/* Every link resolves. The earlier footer had eleven "coming soon"
            entries, which read as an unfinished template rather than roadmap. */}
        <div>
          <h4>Product</h4>
          <ul>
            <li><a href="#ask">Ask DlíFios</a></li>
            <li><a href="#what">Features</a></li>
            <li><a href="#trust">Coverage</a></li>
          </ul>
        </div>
        <div>
          <h4>Sources</h4>
          <ul>
            <li><a href="https://eur-lex.europa.eu/" target="_blank" rel="noopener noreferrer">EUR-Lex</a></li>
            <li><a href="https://www.edpb.europa.eu/" target="_blank" rel="noopener noreferrer">EDPB</a></li>
          </ul>
        </div>
        <div>
          <h4>Project</h4>
          <ul>
            <li>
              <a href="https://github.com/shuklarose/dlifios" target="_blank" rel="noopener noreferrer">
                Source on GitHub
              </a>
            </li>
            <li><a href="/privacy">Privacy Policy</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom pad">
        <span className="copy">© 2026 DlíFios. All rights reserved.</span>
        <span className="copy">
          Answers are AI-generated from official EU sources and are not legal advice.
        </span>
      </div>
    </footer>
  );
}
