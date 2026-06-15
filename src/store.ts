// store.ts — Day 6: embed an act's chunks and store them in Qdrant.
// This completes the ingestion half: fetch -> chunk -> embed -> STORE.
//
// Day 9 refactor: work moved into exported functions so the Hono server can
// trigger ingestion. Day 11 generalisation: ingestCelex(celex, source) ADDS any
// act to the shared collection; the daily monitor calls it for new acts. The
// `reset` flag drops-and-rebuilds (used for full reindexes / embedding swaps).

import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Document } from "@langchain/core/documents";
import { fileURLToPath } from "node:url";

import { LocalEmbeddings } from "./embed.ts";
import { chunkCelex } from "./chunk.ts";
import { CELEX, COLLECTION } from "./config.ts";

// Load QDRANT_URL / QDRANT_API_KEY from .env into process.env (Node built-in).
process.loadEnvFile();

// Embed one act (by CELEX) and store its chunks in the shared collection.
//   - reset:false (default) ADDS the act to whatever's already there — this is
//     what the daily monitor wants when a NEW act appears.
//   - reset:true DROPS the collection first, for a clean full rebuild (e.g.
//     after swapping the embedding model, where vector size changes).
// Returns how many chunks were stored.
export async function ingestCelex(
  celex: string,
  source: string = celex,
  opts: { reset?: boolean } = {}
): Promise<number> {
  if (opts.reset) {
    // deleteCollection is a no-op if it doesn't exist. Qdrant rejects vectors
    // whose size doesn't match an existing collection, so a reset is required
    // when the embedding dimension changes (384-dim MiniLM -> 768-dim mpnet).
    const client = new QdrantClient({
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
    });
    console.log(`Resetting collection "${COLLECTION}"...`);
    await client.deleteCollection(COLLECTION);
  }

  console.log(`Chunking ${source} (${celex})...`);
  const chunks = await chunkCelex(celex, source);

  // LangChain stores "Documents": pageContent (the text to embed) + metadata
  // (rides along, returned with search hits — this is what powers citations).
  const documents = chunks.map(
    (c) =>
      new Document({
        pageContent: c.text,
        metadata: { ...c.metadata, chunkId: c.id },
      })
  );

  console.log(`Embedding ${documents.length} chunks and upserting to Qdrant...`);

  // fromDocuments creates the collection (size 768, cosine) if missing, embeds
  // every document via LocalEmbeddings, and upserts. If the collection already
  // exists it ADDS to it — that's how new acts join the corpus.
  await QdrantVectorStore.fromDocuments(documents, new LocalEmbeddings(), {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION,
  });

  console.log(`Done. Stored ${documents.length} chunks from ${source} in "${COLLECTION}".`);
  return documents.length;
}

// The base corpus: a clean rebuild of the collection from the GDPR.
export function ingestGdpr(): Promise<number> {
  return ingestCelex(CELEX.GDPR, "GDPR", { reset: true });
}

// Run a full GDPR rebuild ONLY when executed directly (npm run store),
// not when server.ts imports these functions.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ingestGdpr();
}
