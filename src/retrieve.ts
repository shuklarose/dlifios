// Embeds a question with the same model used for the corpus and returns the
// nearest chunks. The query half of the pipeline; answer.ts consumes the result.

import { QdrantVectorStore } from "@langchain/qdrant";
import { fileURLToPath } from "node:url";

import { LocalEmbeddings } from "./embed.ts";
import { COLLECTION } from "./config.ts";

process.loadEnvFile();

// Connect to the EXISTING collection (don't re-upload). Lazy singleton so
// repeated searches reuse one connection and one loaded embedding model.
let storePromise: Promise<QdrantVectorStore> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = QdrantVectorStore.fromExistingCollection(new LocalEmbeddings(), {
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: COLLECTION,
    });
  }
  return storePromise;
}

// Top-k nearest chunks to a question, each paired with its similarity score.
// answer.ts feeds the result to the model.
export async function search(question: string, k = 4) {
  const store = await getStore();
  return store.similaritySearchWithScore(question, k);
}

// ---------- Demo: see retrieval by meaning (npm run retrieve) ----------

async function demo() {
  const question = "What are the lawful bases for processing personal data?";
  console.log(`Q: ${question}\n`);

  const results = await search(question, 4);

  for (const [doc, score] of results) {
    const m = doc.metadata;
    const preview = doc.pageContent.slice(0, 110).replace(/\n/g, " ");
    console.log(`[score ${score.toFixed(3)}]  Article ${m.article} - ${m.title}`);
    console.log(`  ${preview}...\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
