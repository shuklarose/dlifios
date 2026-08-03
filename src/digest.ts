// The weekly "what changed" summary. Gathers new acts (SPARQL) and new EDPB
// guidance (RSS), then has the model write them up as {subject, body}. Driven by
// n8n, which pipes the result to a Gmail node.

import { fileURLToPath } from "node:url";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { findNewActs } from "./sources/eurlex.ts";
import { fetchEdpbItems } from "./sources/edpb.ts";
import { GEMINI_MODEL } from "./config.ts";
import "./env.ts";

// Same Gemini config as answer.ts: temperature 0 so the digest reports only
// what's in the lists, never inventing developments.
const model = new ChatGoogleGenerativeAI({
  model: GEMINI_MODEL,
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
  // Pull both sources at once - they're independent network calls.
  const [acts, allGuidance] = await Promise.all([findNewActs(since), fetchEdpbItems()]);

  // findNewActs already filters by date; the EDPB RSS doesn't, so keep only
  // items on/after `since`. If a pubDate won't parse, keep it (better to
  // over-include in a digest than silently drop a real update).
  const sinceTime = new Date(since).getTime();
  const guidance = allGuidance.filter((g) => {
    const t = new Date(g.date).getTime();
    return Number.isNaN(t) ? true : t >= sinceTime;
  });

  // Quiet week - don't waste an LLM call, just say so.
  if (acts.length === 0 && guidance.length === 0) {
    return {
      since,
      subject: "DlíFios weekly digest: nothing new",
      body:
        `No new EU data-protection acts or EDPB guidance since ${since}.` + FOOTER,
      acts,
      guidance,
    };
  }

  // Acts carry their EUR-Lex permalink and guidance its source link, so the
  // model can put a reference under each item instead of naming it and leaving
  // the reader to search for it.
  const actsList =
    acts
      .map(
        (a) =>
          `- ${a.title}\n  Published ${a.date}\n  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=${encodeURIComponent(
            `CELEX:${a.celex}`,
          )}`,
      )
      .join("\n") || "(none)";
  const guidanceList =
    guidance.map((g) => `- ${g.title}\n  ${g.date}\n  ${g.link}`).join("\n") || "(none)";

  // Same anti-invention discipline as the answer chain: summarise only what is
  // listed. The formatting rules matter because this is sent as plain text, so
  // any markdown the model emits arrives as literal asterisks in the inbox.
  const prompt = `Write the body of a weekly email for data-protection professionals,
covering EU developments since ${since}.

CONTENT RULES
- Use ONLY the items listed below. Never invent a development, a date or a detail.
- Keep each item to one sentence saying what it is and who it affects.
- Put the item's URL on its own line directly beneath it.
- If a section has no items, write "Nothing new this week." under that heading.

FORMATTING RULES, these matter because the email is sent as plain text
- Never use markdown. No asterisks, no underscores, no backticks, no hash symbols.
- Write section headings as plain words on their own line followed by a colon,
  for example "New EU acts:" then a blank line.
- Start list items with "- " and nothing else.
- Never use em dashes or en dashes. Use a comma or a full stop.
- Open with one short sentence. Do not add a greeting, a signature, or any
  Subject line.

NEW EU ACTS:
${actsList}

EDPB GUIDANCE:
${guidanceList}

Write the email body now:`;

  const response = await model.invoke(prompt);

  // Belt and braces: models emit markdown regardless of instructions, and this
  // is going out as plain text where it would show as literal punctuation.
  const body = stripMarkdown(response.content as string);

  return {
    since,
    subject: `DlíFios weekly digest: ${count(acts.length, "new act")}, ${count(
      guidance.length,
      "guidance item",
    )}`,
    body: body + FOOTER,
    acts,
    guidance,
  };
}

// "0 new acts", "1 new act", "3 new acts".
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/(^|\s)\*(\S.*?\S)\*(?=\s|$)/g, "$1$2") // italics, not list bullets
    .replace(/^\s*[*+]\s+/gm, "- ") // normalise bullets to a hyphen
    .replace(/^#{1,6}\s*/gm, "") // headings
    .replace(/`/g, "")
    .replace(/[—–]/g, ", ")
    .trimEnd();
}

const FOOTER = `

--
You are receiving this because you opted in to the weekly digest at DlíFios.
Manage or delete your account at https://dlifios.vercel.app`;

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
