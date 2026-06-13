// embed.ts — Day 5: turn text into 384-dim "meaning vectors" with a local model.
// Same model embeds chunks (Day 6) AND questions (Day 7) — that shared space
// is the whole trick of RAG: nearness = relevance.

import { pipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";

const MODEL = "Xenova/all-MiniLM-L6-v2";

// Building the pipeline loads the model (~90 MB) — slow, and we only want it
// ONCE no matter how many times embed() is called. This "lazy singleton" stores
// the in-flight promise the first time, then hands the same one back forever.
let extractorPromise: Promise<any> | null = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL, { dtype: "fp32" });
  }
  return extractorPromise;
}

// One text -> one array of 384 numbers.
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

// Many texts in one call — more efficient than looping embed() (Day 6 uses this).
export async function embedMany(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
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
    "A user has to agree before their information is used.", // B — A's meaning, almost no shared words
    "The fine can be up to 20 million euros.", // C — unrelated topic
  ];

  const vectors = await embedMany(sentences);

  console.log("Vector length:", vectors[0].length, "(expected 384)");
  console.log("\nSimilarity — higher means closer in meaning:");
  console.log("  A vs B (same idea, different words):", similarity(vectors[0], vectors[1]).toFixed(3));
  console.log("  A vs C (unrelated):                  ", similarity(vectors[0], vectors[2]).toFixed(3));
}

// Run the demo ONLY when this file is executed directly (npm run embed),
// not when another file imports embed()/embedMany().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
