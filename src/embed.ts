// Text to 768-dim vectors, using a model that runs locally rather than a paid
// embedding API. The same model embeds both stored chunks and incoming
// questions; that shared space is what makes nearness mean relevance.
//
// all-mpnet-base-v2 replaced all-MiniLM-L6-v2 (384-dim) after MiniLM ranked a
// procedural Article 6 chunk above the one listing the lawful bases: vocabulary
// overlap was beating meaning. mpnet is slower, and correct more often.

import { pipeline } from "@huggingface/transformers";
import { Embeddings } from "@langchain/core/embeddings";
import { fileURLToPath } from "node:url";

const MODEL = "Xenova/all-mpnet-base-v2";

// Building the pipeline loads the model (~420 MB) - slow, and we only want it
// ONCE no matter how many times embed() is called. This "lazy singleton" stores
// the in-flight promise the first time, then hands the same one back forever.
let extractorPromise: Promise<any> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL, { dtype: "fp32" });
  }
  return extractorPromise;
}

// One text -> one array of 768 numbers.
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

// Batched: one call for many texts, rather than looping embed().
export async function embedMany(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

// Adapter so LangChain can drive the local embedder: embedDocuments() for stored
// texts, embedQuery() for searches. Both go through the same model, which is
// what puts chunks and questions in a comparable space.
export class LocalEmbeddings extends Embeddings {
  constructor() {
    super({});
  }
  embedDocuments(texts: string[]): Promise<number[][]> {
    return embedMany(texts);
  }
  embedQuery(text: string): Promise<number[]> {
    return embed(text);
  }
}

// ---------- Demo: prove the meaning-space works (npm run embed) ----------

// Because we normalized to length 1, cosine similarity is just the dot product.
// Range -1..1; higher = closer in meaning.
function similarity(a: number[], b: number[]): number {
  return a.reduce((sum, x, i) => sum + x * b[i], 0);
}

async function demo() {
  const sentences = [
    "The data subject must give consent to the processing.", // A
    "A user has to agree before their information is used.", // B - A's meaning, almost no shared words
    "The fine can be up to 20 million euros.", // C - unrelated topic
  ];

  const vectors = await embedMany(sentences);

  console.log("Vector length:", vectors[0].length, "(expected 768)");
  console.log("\nSimilarity - higher means closer in meaning:");
  console.log("  A vs B (same idea, different words):", similarity(vectors[0], vectors[1]).toFixed(3));
  console.log("  A vs C (unrelated):                  ", similarity(vectors[0], vectors[2]).toFixed(3));
}

// Run the demo ONLY when this file is executed directly (npm run embed),
// not when another file imports embed()/embedMany().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
