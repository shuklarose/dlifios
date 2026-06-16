// digest.ts — Day 12: the weekly "what changed" summary, ready to email.
// This is the 4th product behaviour (Watch/Ingest/Answer/DIGEST). It gathers
// the week's changes from the two sources we built on Day 3 — new EU acts
// (SPARQL) and new EDPB guidance (RSS) — and has Gemini write a readable email.
// n8n's weekly Schedule calls /digest, then pipes {subject, body} to Gmail.

import { fileURLToPath } from "node:url";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { findNewActs } from "./sources/eurlex.ts";
import { fetchEdpbItems } from "./sources/edpb.ts";

process.loadEnvFile();

// Same Gemini config as answer.ts: temperature 0 so the digest reports only
// what's in the lists, never inventing developments.
const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.5-flash",
  temperature: 0,
  apiKey: process.env.GEMINI_API_KEY,
});

export interface Digest {
  since: string;
  subject: string;
  body: string;
  acts: { celex: string; title: string; date: string }[];
  guidance: { title: string; link: string; date: string }[];
}

export async function buildDigest(since: string): Promise<Digest> {
  // Pull both sources at once — they're independent network calls.
  const [acts, allGuidance] = await Promise.all([findNewActs(since), fetchEdpbItems()]);

  // findNewActs already filters by date; the EDPB RSS doesn't, so keep only
  // items on/after `since`. If a pubDate won't parse, keep it (better to
  // over-include in a digest than silently drop a real update).
  const sinceTime = new Date(since).getTime();
  const guidance = allGuidance.filter((g) => {
    const t = new Date(g.date).getTime();
    return Number.isNaN(t) ? true : t >= sinceTime;
  });

  // Quiet week — don't waste an LLM call, just say so.
  if (acts.length === 0 && guidance.length === 0) {
    return {
      since,
      subject: "DlíFios weekly digest — no new developments",
      body: `No new EU data-protection acts or EDPB guidance since ${since}.`,
      acts,
      guidance,
    };
  }

  const actsList = acts.map((a) => `- [${a.celex}, ${a.date}] ${a.title}`).join("\n") || "(none)";
  const guidanceList = guidance.map((g) => `- [${g.date}] ${g.title}`).join("\n") || "(none)";

  // Strict prompt: summarise ONLY the listed items, no invention — same
  // anti-hallucination discipline as the /ask chain.
  const prompt = `You are writing a weekly email digest for data-protection professionals,
covering new EU developments since ${since}. Summarise the items below into a concise,
scannable plain-text email with two sections: "New EU acts" and "EDPB guidance".
Use ONLY the items listed — do not invent developments or details. If a section has no
items, write "Nothing new this week." under it.

NEW EU ACTS:
${actsList}

EDPB GUIDANCE:
${guidanceList}

Write the email body now:`;

  const response = await model.invoke(prompt);

  return {
    since,
    subject: `DlíFios weekly digest — ${acts.length} new act(s), ${guidance.length} guidance item(s)`,
    body: response.content as string,
    acts,
    guidance,
  };
}

// ---------- Demo: run with `npm run digest` ----------

async function demo() {
  // A week's window. (Use a wider one to see real content during testing.)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Building digest since ${since}...\n`);

  const d = await buildDigest(since);
  console.log(`SUBJECT: ${d.subject}\n`);
  console.log(d.body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
