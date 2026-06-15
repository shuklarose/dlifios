// answer.ts — Day 8 (THE milestone): retrieved chunks + question -> cited answer.
// This is the full RAG loop: search() finds the law, Gemini writes the answer
// grounded ONLY in that law, citing article numbers.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { fileURLToPath } from "node:url";

import { search } from "./retrieve.ts";

process.loadEnvFile();

// temperature 0 = least "creative", most faithful to the passages — what we want
// for legal answers. gemini-2.5-flash is the current free-tier Flash model.
const model = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0,
  apiKey: process.env.GEMINI_API_KEY,
});

// The prompt is the heart of RAG: it ORDERS the model to use only the supplied
// passages and to cite articles, and to admit when the answer isn't there.
// This is what prevents hallucination and produces citations.
function buildPrompt(question: string, context: string): string {
  return `You are a legal assistant answering questions about the EU GDPR.
Answer the QUESTION using ONLY the CONTEXT passages below.
Cite the relevant article number after each claim, like "(Article 6)".
If the answer is not contained in the context, say you don't know — do not invent.

CONTEXT:
${context}

QUESTION: ${question}

ANSWER:`;
}

export async function ask(question: string, k = 5) {
  // 1. Retrieve the nearest chunks (Day 7).
  const hits = await search(question, k);

  // 2. Format them into a labelled context block. The "[Article N — Title]"
  //    header is what lets the model cite accurately.
  const context = hits
    .map(([doc]) => `[Article ${doc.metadata.article} — ${doc.metadata.title}]\n${doc.pageContent}`)
    .join("\n\n");

  // 3. Ask Gemini, grounded in that context.
  const response = await model.invoke(buildPrompt(question, context));

  // 4. Hand back the answer plus which articles informed it (for display/citation).
  const sources = hits.map(([doc]) => `Article ${doc.metadata.article} — ${doc.metadata.title}`);
  return { answer: response.content as string, sources };
}

// ---------- Demo: the payoff (npm run ask) ----------

async function demo() {
  const question = "What are the lawful bases for processing personal data?";
  console.log(`Q: ${question}\n`);

  const { answer, sources } = await ask(question);

  console.log(answer);
  console.log("\n--- retrieved from ---");
  for (const s of [...new Set(sources)]) console.log(`  • ${s}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
