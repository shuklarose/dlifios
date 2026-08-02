# DlíFios

**Know the Law. Cite the Source.**

A retrieval-augmented question-answering system for EU data-protection law. Ask a question in plain English, get an answer grounded in the actual legal text - with every claim cited to a specific article and linked to the official source on EUR-Lex.

The name is Irish: *dlí* (law) + *fios* (knowledge).

---

## Why this exists

General-purpose chatbots answer legal questions confidently and sometimes wrongly. They invent article numbers. For a compliance officer deciding whether a processing activity is lawful, a fabricated citation is worse than no answer at all.

DlíFios is built so that **it cannot answer from memory**. Every response is constructed from passages retrieved out of the primary legal text, and the model is instructed to refuse when the retrieved passages don't contain the answer. If it can't cite it, it doesn't say it.

```
Ask: "What are the lawful bases for processing personal data?"
→ Six bases, each cited to (GDPR Article 6), linked to EUR-Lex

Ask: "hi"
→ "That is outside what I cover."  ← no answer, and no citations either
```

That second case matters more than the first. It's the difference between a demo and a tool.

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
  EUR-Lex Cellar ──▶│  INGEST                                 │
  (official texts)  │  fetch HTML → split by Article →        │
                    │  embed (768-dim) → upsert               │
                    └──────────────────┬──────────────────────┘
                                       ▼
                            ┌─────────────────────┐
                            │  Qdrant Cloud       │
                            │  531 vectors        │
                            │  cosine, 768-dim    │
                            └──────────┬──────────┘
                                       │
  ┌────────────┐   question   ┌────────▼──────────┐
  │  Browser   │─────────────▶│  ASK              │
  │            │              │  embed question   │
  │            │              │  → top-k search   │
  │            │◀─────────────│  → Gemini w/ ctx  │
  └────────────┘  answer +    │  → filter cites   │
                  citations   └───────────────────┘

  ┌────────────┐              ┌───────────────────┐
  │  Supabase  │              │  n8n workflows    │
  │  auth      │              │  monitor: daily   │
  │  profiles  │              │  digest:  weekly  │
  │  quotas    │              └───────────────────┘
  └────────────┘
```

### The retrieval pipeline

| Stage | File | What it does |
|---|---|---|
| Fetch | `src/sources/eurlex.ts` | Pulls official act HTML from the EU's Cellar repository by CELEX id |
| Chunk | `src/chunk.ts` | Splits by **Article**, not by character count - so a chunk is always a complete legal provision |
| Embed | `src/embed.ts` | `Xenova/all-mpnet-base-v2`, 768-dim, runs locally - no embedding API cost |
| Store | `src/store.ts` | Upserts into Qdrant with `{source, celex, article, title}` metadata |
| Retrieve | `src/retrieve.ts` | Cosine similarity, top-k |
| Answer | `src/answer.ts` | System prompt + retrieved context → Gemini 2.5 Flash |

**Why chunk by article?** Fixed-size chunking splits mid-sentence and severs a provision from its own heading. Article boundaries are the natural semantic unit of legislation - and they're also what you cite. Chunking on them means the citation is a property of the chunk, not something the model has to reconstruct.

**Why local embeddings?** The corpus is embedded once and queries are embedded per-request. Running the model locally removes a per-query API cost and a network dependency from the hot path.

---

## Grounding, and how it's enforced

Three independent mechanisms, because prompt instructions alone are not a guarantee:

1. **System prompt** - rules live in the system role, not the user turn, where they outrank conversation content. The model is told to answer only from context, to refuse otherwise, and to never write a bare article number (`GDPR Article 6` and `AI Act Article 6` are different laws).

2. **Citation filtering** (`src/answer.ts`) - retrieval always returns *k* passages, even for nonsense input. Sources are filtered to only those articles the answer actually references, matched with a word boundary so *Article 6* doesn't match *Article 65*. A refusal therefore shows no sources. Without this, "hi" produced an "I don't know" decorated with three authoritative-looking EU citations.

3. **Linked citations, with the passage attached** - every source resolves to a real EUR-Lex permalink built from its CELEX number, and carries the retrieved text itself. The UI puts that behind a disclosure under each citation, so the claim and the evidence for it sit together and a reader can check one against the other without leaving the page.

---

## Access control

| Caller | Limit | Enforced by |
|---|---|---|
| Anonymous | 3 questions / 24h | In-memory per-IP counter |
| Signed in | 20 questions / 24h | `question_log` rows in Postgres |
| n8n / machine | unlimited | Shared secret (`ADMIN_TOKEN`) |

Authentication is **magic link only** - no passwords are stored, hashed, or transmitted. Signup writes form fields into `raw_user_meta_data`, and a Postgres trigger (`supabase/02_new_user_trigger.sql`) copies them into `public.profiles` the instant the auth user is created. The database guarantees the profile exists; no application code can forget to create it.

Row Level Security is enabled on every table. `profiles` policies scope reads and writes to `auth.uid() = id`. `question_log` has RLS enabled with **no policies at all** - meaning no client can touch it, and only the server's service-role key can write. That's deliberate: it's a billing ledger, not user-facing data.

> **On the anon key being public:** the Supabase anon key is served to the browser by design. It is only safe *because* RLS is enforced on every table - the key grants nothing that a policy doesn't allow. The service-role key, which bypasses RLS, never leaves the server.

---

## Security posture

Audited against a 5-part checklist (Gitleaks / Bearer / ECC production audit) before first deploy.

**Implemented**
- No secrets in source. `.env` gitignored and never committed (verified across full git history); `.env.example` documents every variable.
- `/ingest`, `/monitor`, `/digest` require `ADMIN_TOKEN` and **fail closed** if it isn't configured. These are the expensive endpoints - `/ingest` re-embeds the corpus and with `{"reset": true}` deletes it first. Left open, they were a corpus-destruction and API-bill vector.
- Token comparison is length-checked and constant-time, so response timing doesn't leak how much of a guess was correct.
- Security headers on every response: CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS, Referrer-Policy.
- Server never trusts a client-supplied user id - tokens are verified with `supabaseAdmin.auth.getUser()`.
- Questions are logged *before* the paid model call, so a failure mid-request can't be used to get free queries.
- No PII in request-path logs.
- `/ask` validates server-side: question trimmed, non-empty, capped at 1000
  characters, and `k` constrained to 1-20. Unbounded, either field is a billing
  vector rather than a crash.
- `npm audit` clean apart from `sharp`/libvips CVEs reached through
  `@huggingface/transformers`. No upstream fix exists; they are image-decoding
  bugs and this project only runs text embeddings, so the path is unreachable.
- `strict` TypeScript, zero errors.
- **Right to erasure** (Art. 17) is self-serve: `DELETE /account` removes the profile, every logged question and the auth user in one step. Scoped to the token holder - it takes no user id, so it cannot be aimed at another account. Deletion order is chosen so no orphan rows survive.
- A **privacy policy** at `/privacy`, written from the code rather than a template, disclosing that question text is sent to Google.

**Known gaps** - documented rather than hidden:
- CSP includes `'unsafe-inline'` because page CSS/JS are inline in `index.html`. Fixing this means extracting them to files.
- The anonymous rate limiter is in-process: it resets on restart and isn't shared across instances. Fine for one server, needs Redis beyond that. It also can't distinguish people behind one NAT gateway - which is part of the argument for signing up.
- Session tokens live in `localStorage` (the supabase-js default). Standard practice, but reachable by any script on the page - which is part of why the CSP above matters.

---

## Running it

**Prerequisites:** Node 22+, a Qdrant Cloud cluster, a Supabase project, a Gemini API key.

```bash
git clone <repo-url> && cd dlifios
npm install
cp .env.example .env      # then fill in your own values
```

Set up the database - run these in the Supabase SQL editor, in order:

```
supabase/schema.sql                 # tables + RLS policies
supabase/02_new_user_trigger.sql    # auto-create profiles row on signup
```

In **Authentication → URL Configuration**, set the Site URL and add it to Redirect URLs (`http://localhost:3000` for local).

Build the corpus, then serve:

```bash
npm run store     # fetch, chunk, embed and upsert the acts (~2 min)
npm run serve     # http://localhost:3000
```

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the API + UI |
| `npm run typecheck` | `tsc` under `strict` |
| `npm run serve` | Same as start |
| `npm run ask` | Answer one question from the CLI |
| `npm run store` | Rebuild the corpus |
| `npm run monitor` | Find and ingest newly published acts |
| `npm run digest` | Generate the weekly email digest |
| `npm run db:check` | Verify the Supabase connection |
| `npm run probe` | Check all three upstream EU data sources |

---

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | - | The UI |
| `GET /health` | - | Liveness |
| `GET /config` | - | Public browser config (Supabase URL + anon key) |
| `POST /ask` | optional | Ask a question. Quota depends on whether a token is sent |
| `GET /history` | user token | The caller's own past questions |
| `DELETE /account` | user token | Erase the caller's profile, questions and login |
| `GET /privacy` | - | Privacy policy |
| `POST /ingest` | `ADMIN_TOKEN` | Ingest an act by CELEX id |
| `POST /monitor` | `ADMIN_TOKEN` | Discover + ingest newly published acts |
| `POST /digest` | `ADMIN_TOKEN` | Build the weekly digest |

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

---

## Scheduled jobs

Two n8n workflows in [`n8n/`](n8n/) keep the corpus current and send the weekly
digest. Both call the `ADMIN_TOKEN`-gated machine routes.

| Workflow | Schedule | Endpoint |
|---|---|---|
| Corpus monitor | Daily 06:00 | `POST /monitor` |
| Weekly digest | Monday 08:00 | `POST /digest` |

They are exported without credentials and ship inactive, so importing them is a
deliberate step rather than something that starts firing on clone. Setup is in
[`n8n/README.md`](n8n/README.md).

`/ask` is not a workflow. A user is waiting on that response, so it belongs in
the request path.

## Deployment

The API runs as a container on [Coolify](https://coolify.io); the UI can be
served either by that same container or separately as a static page.

**Backend (Coolify).** Point it at the repo, set the variables from
`.env.example`, expose port 3000. The `/health` healthcheck gates traffic to a
new container.

**Frontend (optional split).** `public/index.html` is a single self-contained
file and can be hosted anywhere static, Vercel included. Two settings connect
the halves:

| Where | Setting |
|---|---|
| `public/index.html` | `<meta name="dlifios-api-base" content="https://api.example.com">` |
| Backend env | `ALLOWED_ORIGINS=https://your-frontend.vercel.app` |

CORS is an allowlist, not `*`. These routes carry an `Authorization` header, and
a wildcard origin would let any site make authenticated calls with a user's
token. Unset, it stays closed, which is the correct default for the single-origin
setup.

Either way, add the live domain to Supabase under **Authentication -> URL
Configuration**, as Site URL and in Redirect URLs, or magic links will bounce.

**Why the API needs a persistent container.** Three properties of the app rather
than preferences:

1. The anonymous rate limiter holds counters in process memory. A serverless
   runtime gives each invocation a fresh instance, so every caller looks new and
   the cap silently stops working.
2. The embedding model is a large download held in memory; cold starts would
   re-download it or time out.
3. Ingestion runs for minutes, past a typical function timeout.

Points 1 and 2 are also the argument for a single instance: scaling out needs
Redis-backed rate limiting first.

## Stack

TypeScript (ESM, no build step - `tsx`) · Hono · Qdrant Cloud · `@huggingface/transformers` · LangChain · Gemini 2.5 Flash · Supabase (Auth + Postgres + RLS) · n8n

No dotenv - Node's built-in `process.loadEnvFile()`. No frontend framework; the UI is one self-contained HTML file served from the same origin as the API, so there's no CORS surface and no separate deploy.

---

## Corpus

| Act | CELEX |
|---|---|
| GDPR - Regulation (EU) 2016/679 | `32016R0679` |
| AI Act - Regulation (EU) 2024/1689 | `32024R1689` |
| Commission Decision (EU) 2026/713 | `32026D0713` |

531 vectors. The third arrived via the automated monitor, which is the point: the corpus grows without anyone touching it.

---

## Roadmap

- [x] Account deletion + privacy policy *(GDPR Art. 17)*
- [ ] Evaluation set with a retrieval accuracy score *(highest priority)*
- [ ] Weekly digest delivery to registered users
- [ ] Welcome email via Supabase webhook → n8n
- [ ] CJEU case law from Curia *(deliberately not claimed as a source until it's real)*
- [ ] Answer feedback capture
- [ ] Redis-backed rate limiting

---

## License

ISC
