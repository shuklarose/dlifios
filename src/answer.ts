// answer.ts — Day 8 (THE milestone): retrieved chunks + question -> cited answer.
// This is the full RAG loop: search() finds the law, Gemini writes the answer
// grounded ONLY in that law, citing article numbers.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
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

function buildPrompt(question: string, context: string): string {
  return `You are a legal assistant answering questions about EU data-protection law.
The CONTEXT passages may come from DIFFERENT acts (e.g. GDPR, AI_ACT), so every
passage is labelled with the act it belongs to.
Answer the QUESTION using ONLY the CONTEXT passages below.
Cite the act AND the article after each claim, like "(GDPR Article 6)". Never cite
a bare article number: GDPR Article 6 and AI_ACT Article 6 are different laws, and
an unqualified "(Article 6)" is worse than useless to a reader.
If the answer is not contained in the context, say you don't know — do not invent.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;
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

  // 3. Ask Gemini, grounded in that context.
  const response = await model.invoke(buildPrompt(question, context));

  // 4. Hand back the answer plus which articles informed it (for display/citation).
  // Deduplicate by label: two chunks from the same article are one citation.
  // A Map keyed on the label keeps the first occurrence and drops repeats,
  // preserving retrieval order (most relevant first).
  const byLabel = new Map<string, Source>();
  for (const [doc] of hits) {
    const s = toSource(doc.metadata);
    if (!byLabel.has(s.label)) byLabel.set(s.label, s);
  }
  return { answer: response.content as string, sources: [...byLabel.values()] };
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
