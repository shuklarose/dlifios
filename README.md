<div align="center">

# DlíFios

### Know the Law. Cite the Source.

**A question-answering system for EU data-protection law that cannot answer from memory.**

Every claim is traced to an article of the actual legislation and linked to the official text.
When the law does not cover your question, it says so instead of guessing.

[**Live app**](https://dlifios.vercel.app) &nbsp;·&nbsp; [Architecture](#architecture) &nbsp;·&nbsp; [How grounding is enforced](#how-grounding-is-enforced) &nbsp;·&nbsp; [Run it yourself](#run-it-yourself)

`TypeScript` `Hono` `Qdrant` `Gemini` `Supabase` `Docker` `n8n`

</div>

---

## The problem

General-purpose chatbots answer legal questions confidently, and sometimes invent the article number. For someone deciding whether a processing activity is lawful, a fabricated citation is worse than no answer at all: it is wrong in a way that looks authoritative.

DlíFios is built so that cannot happen. Answers are assembled only from passages retrieved out of the primary legal text, and the model is instructed to refuse when those passages do not contain the answer.

```
"What are the lawful bases for processing personal data?"

  -> All six bases, each cited to (GDPR Article 6)
  -> Every citation links to the official EUR-Lex text
  -> Expandable: read the exact passage the answer came from


"hi"

  -> "That is outside what I cover."
  -> No answer, and no citations either
```

**The second case is the harder one to get right.** Retrieval returns passages for any input, so the naive implementation decorates a non-answer with three authoritative-looking references. Suppressing that is a deliberate mechanism, described below.

---

## Architecture

```
                        ┌───────────────────────────────────────────┐
   EUR-Lex Cellar ─────▶│  INGEST                                   │
   (official texts)     │  fetch act HTML                           │
                        │  split on article boundaries              │
                        │  embed locally (768-dim)                  │
                        └────────────────────┬──────────────────────┘
                                             ▼
                                  ┌─────────────────────┐
                                  │   Qdrant Cloud      │
                                  │   cosine, 768-dim   │
                                  └──────────┬──────────┘
                                             │
   ┌────────────┐    question    ┌───────────▼───────────┐
   │  Browser   │───────────────▶│  ASK                  │
   │  (Vercel)  │                │  embed the question   │
   │            │                │  top-k search         │
   │            │◀───────────────│  generate from context│
   └────────────┘  answer +      │  filter citations     │
                   evidence      └───────────────────────┘
                                        (Coolify)

   ┌────────────┐                 ┌───────────────────────┐
   │  Supabase  │                 │  n8n                  │
   │  auth      │                 │  monitor  daily 06:00 │
   │  profiles  │                 │  digest   Mon   08:00 │
   │  usage log │                 └───────────────────────┘
   └────────────┘
```

### The pipeline

| Stage | File | What it does |
|---|---|---|
| Fetch | `src/sources/eurlex.ts` | Pulls act HTML from the EU's Cellar service by CELEX id |
| Chunk | `src/chunk.ts` | Splits on **article boundaries**, not character count |
| Embed | `src/embed.ts` | `all-mpnet-base-v2`, 768-dim, runs locally |
| Store | `src/store.ts` | Upserts to Qdrant with act, CELEX, article, title |
| Retrieve | `src/retrieve.ts` | Cosine similarity, top-k |
| Answer | `src/answer.ts` | System prompt plus retrieved context, then citation filtering |

<details>
<summary><b>Why chunk on article boundaries?</b></summary>

Fixed-size chunking splits mid-sentence and severs a provision from its own heading. Article boundaries are the natural semantic unit of legislation, and they are also what a lawyer cites.

Chunking on them makes the citation a property of the chunk rather than something the model has to reconstruct, which is what allows a claim to be traced back to an exact article.

Definitions articles get a second level of splitting, one chunk per definition. Measured on GDPR Article 4, the size-based splitter put `pseudonymisation`, `filing system`, `controller` and `processor` in one chunk, so its embedding landed at the centroid of four unrelated concepts and matched none of them. "What is a data controller?" could not retrieve the chunk defining a controller.
</details>

<details>
<summary><b>Why embed locally instead of using an API?</b></summary>

The corpus is embedded once, but every question is embedded at query time. Running the model in-process removes a per-query cost and a network dependency from the hot path. The model is baked into the Docker image, so a cold start does not wait on a download.
</details>

---

## How grounding is enforced

Three independent mechanisms, because a prompt instruction alone is not a guarantee.

### 1. Rules live in the system role

Not in the user turn. Models weight system instructions above conversation content, so the constraints are materially harder to talk the model out of, and the constant half of the prompt stays cacheable.

The model is told to answer only from context, to refuse otherwise, and never to write a bare article number: `GDPR Article 6` and `AI Act Article 6` are different laws, so an unqualified number misleads.

### 2. Citations are filtered against the answer

Retrieval returns *k* passages for any input, including nonsense. Sources are filtered down to only those articles the answer actually references, matched on a word boundary so *Article 6* does not match *Article 65*.

**A refusal therefore cites nothing.** Without this, `hi` produced an "I don't know" decorated with three real EU citations.

### 3. Every citation is verifiable

Each source carries a EUR-Lex permalink built from its CELEX number, plus the retrieved passage itself. The UI puts that passage behind a disclosure under the citation, so the claim and its evidence sit together and a reader can check one against the other without leaving the page.

---

## Access control

| Caller | Limit | Enforced by |
|---|---|---|
| Anonymous | 3 questions / 24h | In-memory counter, per IP |
| Signed in | 20 questions / 24h | Rows in Postgres |
| Scheduled jobs | unlimited | Shared secret |

**Authentication is passwordless.** Sign-in is by emailed code or magic link, so no password is ever stored, hashed, or transmitted. Signup fields ride along in the auth metadata, and a Postgres trigger copies them into `profiles` the instant the account exists, so the database guarantees the profile rather than relying on application code.

Row Level Security is on for every table. `profiles` is scoped to `auth.uid() = id`. The usage log has RLS enabled with **no policies at all**, so no browser can read it and only the server can write. That is deliberate: it is a billing ledger, not user data.

> The Supabase anon key is public by design. It is safe only *because* RLS is enforced on every table. The service-role key, which bypasses RLS, never leaves the server.

---

## Security

Audited against Gitleaks, Bearer and ECC production-audit checklists before deploying.

**Implemented**

- No secrets in source. `.env` gitignored and never committed at any point in history
- `/ingest`, `/monitor` and `/digest` require a shared secret and **fail closed** when it is unset. `/ingest` re-embeds the corpus and with `reset` drops it first, so unauthenticated these were a corpus-destruction and billing vector
- Token comparison is constant-time, so response timing does not leak a partial guess
- CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy on every response
- CORS is an allowlist, never `*`: these routes carry an `Authorization` header, and a wildcard origin would let any site call them with a user's token
- Server-side input validation. Question length and `k` are both capped, because unbounded either one is a billing vector rather than a crash
- A user id supplied by the client is never trusted; tokens are verified with Supabase
- Questions are counted *before* the model call, so a mid-request failure cannot be used for free queries
- **Right to erasure** (GDPR Art. 17) is self-serve and immediate. Deletion order is chosen so no orphan rows survive
- A privacy policy written from the code rather than a template, disclosing that question text reaches the model provider
- `strict` TypeScript, zero errors

**Known limits, documented rather than hidden**

- CSP retains `unsafe-inline` because page CSS and JS are inline. Extracting them is the fix
- The anonymous limiter is in-process: it resets on restart and is not shared across instances. It also cannot tell people apart behind one NAT gateway, which is part of the argument for accounts
- Retrieval has no notion of recency, so "what is the newest law" is answered by meaning rather than by date

---

## Corpus

| Act | CELEX | Indexed |
|---|---|---|
| GDPR, Regulation (EU) 2016/679 | `32016R0679` | 99 articles |
| EU AI Act, Regulation (EU) 2024/1689 | `32024R1689` | 113 articles |
| Council Decision (EU) 2026/713 | `32026D0713` | added by the monitor |
| Council Decision (EU) 2026/728 | `32026D0728` | added by the monitor |

The last two arrived without anyone touching the system. That is the point of the daily job.

**Not covered:** no case law, so questions about CJEU judgments get a refusal rather than a guess.

---

## Run it yourself

**Requires** Node 22+, a Qdrant Cloud cluster, a Supabase project, a Gemini API key.

```bash
git clone https://github.com/shuklarose/dlifios && cd dlifios
npm install
cp .env.example .env        # fill in your own values
```

Run these in the Supabase SQL editor, in order:

```
supabase/schema.sql                 tables and RLS policies
supabase/02_new_user_trigger.sql    auto-create a profile on signup
supabase/03_digest_consent.sql      digest opt-in
```

Then build the corpus and start:

```bash
npm run store     # fetch, chunk, embed, upsert  (~2 min)
npm start         # http://localhost:3000
```

### Commands

| Command | Does |
|---|---|
| `npm start` | Run the API and UI |
| `npm run typecheck` | `tsc` under `strict` |
| `npm run ask` | Answer one question from the CLI |
| `npm run store` | Rebuild the corpus |
| `npm run monitor` | Find and ingest newly published acts |
| `npm run digest` | Generate the weekly digest |
| `npm run probe` | Check the three upstream EU sources |

---

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | none | The app |
| `GET /health` | none | Liveness |
| `GET /config` | none | Public browser config |
| `POST /ask` | optional | Ask a question. Quota depends on the token |
| `GET /history` | user | The caller's own past questions |
| `DELETE /account` | user | Erase profile, questions and login |
| `POST /ingest` | secret | Ingest an act by CELEX id |
| `POST /monitor` | secret | Discover and ingest new acts |
| `POST /digest` | secret | Build the weekly digest |

<details>
<summary><b>Example response</b></summary>

```bash
curl -X POST localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What are the lawful bases for processing personal data?"}'
```

```jsonc
{
  "answer": "Processing of personal data is lawful only if...",
  "sources": [
    {
      "label": "GDPR Article 6 - Lawfulness of processing",
      "act": "GDPR",
      "article": "6",
      "celex": "32016R0679",
      "url": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679",
      "excerpt": "Article 6 Lawfulness of processing 1. Processing shall be lawful only if..."
    }
  ],
  "signedIn": true,
  "used": 3,
  "limit": 20
}
```
</details>

---

## Deployment

The API runs as a container; the UI is a single self-contained HTML file that can be hosted anywhere static.

| Piece | Runs on |
|---|---|
| API | Docker container (Coolify) |
| UI | Static hosting (Vercel) |
| Vectors | Qdrant Cloud |
| Auth and data | Supabase |
| Schedules | n8n |

Two settings connect the halves when they are hosted separately:

| Where | Setting |
|---|---|
| `public/index.html` | `<meta name="dlifios-api-base" content="https://api.example.com">` |
| API environment | `ALLOWED_ORIGINS=https://your-frontend.example.com` |

<details>
<summary><b>Why the API needs a persistent container</b></summary>

Three properties of the app, not preferences:

1. The anonymous rate limiter holds counters in process memory. A serverless runtime gives each invocation a fresh instance, so every caller looks new and the cap silently stops working
2. The embedding model is a large in-memory download; cold starts would re-fetch it or time out
3. Ingestion runs for minutes, past a typical function timeout

Points 1 and 2 are also the argument for a single instance. Scaling out needs Redis-backed limiting first.
</details>

---

## Scheduled jobs

Two n8n workflows in [`n8n/`](n8n/) keep the corpus current and send the digest.

| Workflow | Schedule | Calls |
|---|---|---|
| `workflow-monitor.json` | Daily 06:00 | `POST /monitor` |
| `workflow-digest.json` | Monday 08:00 | `POST /digest` |

Exported without credentials and inactive, so importing them is deliberate rather than something that starts firing on clone. Create a Header Auth credential named `Dlifios admin token` holding `Bearer <secret>`, import both, and replace the placeholder host.

Two results look like failures and are not: the monitor finding zero acts (the EU does not publish data-protection law most weeks), and the digest returning an empty recipient list before anyone opts in.

`/ask` is deliberately not a workflow. A user is waiting on that response, so it belongs in the request path.

---

## Roadmap

- [ ] Retrieval evaluation set with an accuracy score
- [ ] Date-aware retrieval, so "the most recent act" is answerable
- [ ] CJEU case law, once ingested rather than claimed
- [ ] Answer feedback capture
- [ ] Redis-backed rate limiting for multi-instance deployment

---

<div align="center">

*The name is Irish: **dlí** (law) + **fios** (knowledge).*

Answers are AI-generated from official EU sources and are not legal advice.

</div>
