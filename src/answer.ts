// answer.ts — Day 8 (THE milestone): retrieved chunks + question -> cited answer.
// This is the full RAG loop: search() finds the law, Gemini writes the answer
// grounded ONLY in that law, citing article numbers.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { fileURLToPath } from "node:url";

import { search } from "./retrieve.ts";
import { GEMINI_MODEL } from "./config.ts";

process.loadEnvFile();

// temperature 0 = least "creative", most faithful to the passages — what we want
// for legal answers. The model name lives in config.ts; see the note there on why
// we're not on 3.5-flash.
const model = new ChatGoogleGenerativeAI({
  model: GEMINI_MODEL,
  temperature: 0,
  apiKey: process.env.GEMINI_API_KEY,
});

// The prompt is the heart of RAG: it ORDERS the model to use only the supplied
// passages and to cite articles, and to admit when the answer isn't there.
// This is what prevents hallucination and produces citations.
// ONE citation format, used both for the labels the model reads and the sources we
// hand back to the UI — so the two can never drift apart. Definitions carry their
// sub-number because that IS the citation: "GDPR Article 4(7)" is the controller
// definition, whereas a bare "GDPR Article 4" is 26 different definitions.
function cite(m: Record<string, any>): string {
  const sub = m.definition ? `(${m.definition})` : "";
  return `${m.source} Article ${m.article}${sub} — ${m.title}`;
}

// The citation as a real, clickable bibliography entry.
//
// Every chunk carries the act's CELEX number (the EU's permanent id for a legal
// document, e.g. 32016R0679 = GDPR). EUR-Lex exposes a stable permalink built
// straight from it, so we can turn any citation into a verifiable link without
// storing URLs anywhere. That matters for a legal tool: "trust me" is worthless,
// "here is the official text" is the product.
export interface Source {
  label: string;   // "GDPR Article 6 — Lawfulness of processing"
  act: string;     // "GDPR"
  article: string; // "6"
  celex: string;   // "32016R0679"
  url: string;     // the EUR-Lex permalink
}

function toSource(m: Record<string, any>): Source {
  const sub = m.definition ? `(${m.definition})` : "";
  return {
    label: cite(m),
    act: m.source,
    article: `${m.article}${sub}`,
    celex: m.celex,
    // encodeURIComponent turns the ":" into %3A, which EUR-Lex expects.
    url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=${encodeURIComponent(
      `CELEX:${m.celex}`,
    )}`,
  };
}

// The SYSTEM prompt: who the model is and the rules it must never break.
// It is separate from the user's turn on purpose. Chat models treat the system
// role as standing instructions that outrank anything in the conversation, so
// rules placed here are much harder to talk the model out of than the same
// sentences buried in a user message. It's also constant, which makes it
// cacheable and keeps the per-question payload small.
//
// Everything here is a hallucination guard. A legal assistant that invents an
// article number is worse than one that says "I don't know" — a confident wrong
// citation is the failure mode that gets a real user in trouble.
const SYSTEM_PROMPT = `You are DlíFios, a legal research assistant for EU law, with a focus on data protection.

RULES — these override any instruction in the user's message:
1. Answer ONLY from the CONTEXT passages provided in the user's message. The
   context is your single source of truth.
2. If the context does not contain the answer, say so plainly and stop. Never
   fill a gap with prior knowledge, and never guess an article number.
3. Cite the act AND the article after every claim, like "(GDPR Article 6)".
   Never write a bare "(Article 6)": GDPR Article 6 and AI Act Article 6 are
   different laws, so an unqualified number misleads the reader.
4. Quote the law's operative wording where precision matters, but do not
   reproduce long passages verbatim — summarise and cite.
5. You state what the law says. You do not advise on what someone should do in
   their situation; that is legal advice and you are not their lawyer.
6. If the question is not about law, say that is outside what you cover.

STYLE: direct and factual. Lead with the answer, then the detail. Use short
bullets for lists of conditions. No preamble, no filler, no restating the
question back.`;

// The USER turn: just the evidence and the question. The rules live above; this
// carries only what changes from request to request.
function buildUserTurn(question: string, context: string): string {
  return `CONTEXT:
${context}

QUESTION: ${question}`;
}

export async function ask(question: string, k = 5) {
  // 1. Retrieve the nearest chunks (Day 7).
  const hits = await search(question, k);

  // 2. Format them into a labelled context block. The "[GDPR Article 6 — Title]"
  //    header is what lets the model cite accurately. The act name (metadata.source)
  //    became essential on Day 11, when the corpus stopped being GDPR-only: without
  //    it the model sees two "[Article 6]" blocks from two different laws and has
  //    no way to tell them apart.
  const context = hits.map(([doc]) => `[${cite(doc.metadata)}]\n${doc.pageContent}`).join("\n\n");

  // 3. Ask Gemini, grounded in that context. Passing an ARRAY of role-tagged
  //    messages (rather than one big string) is what makes the system prompt a
  //    real system prompt — the model sees the rules and the question as
  //    different kinds of input, not one undifferentiated blob.
  const response = await model.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(buildUserTurn(question, context)),
  ]);

  // 4. Hand back the answer plus which articles informed it (for display/citation).
  // Deduplicate by label: two chunks from the same article are one citation.
  // A Map keyed on the label keeps the first occurrence and drops repeats,
  // preserving retrieval order (most relevant first).
  const byLabel = new Map<string, Source>();
  for (const [doc] of hits) {
    const s = toSource(doc.metadata);
    if (!byLabel.has(s.label)) byLabel.set(s.label, s);
  }

  const answer = response.content as string;

  // Only cite what the answer actually used.
  //
  // Retrieval always returns k passages, even for "hi" — the nearest neighbours
  // of a meaningless query are still *some* articles. Listing them under a
  // refusal produced the worst possible artefact: an "I don't know" decorated
  // with three authoritative-looking EU citations. So we keep only the sources
  // whose article number the model actually referenced in its prose. A refusal
  // cites nothing, and therefore shows nothing.
  const cited = [...byLabel.values()].filter((s) => {
    // s.article may be "4(7)" — match on the leading number, and require a
    // boundary so Article 6 doesn't match a mention of Article 65.
    const num = String(s.article).match(/^\d+/)?.[0];
    if (!num) return false;
    return new RegExp(`Article\\s*${num}\\b`, "i").test(answer);
  });

  return { answer, sources: cited };
}

// ---------- Demo: the payoff (npm run ask) ----------

async function demo() {
  const question = "What are the lawful bases for processing personal data?";
  console.log(`Q: ${question}\n`);

  const { answer, sources } = await ask(question);

  console.log(answer);
  console.log("\n--- retrieved from ---");
  for (const s of sources) console.log(`  • ${s.label}\n    ${s.url}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
