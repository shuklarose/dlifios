// store.ts — Day 6: embed every GDPR chunk and store it in Qdrant.
// This completes the ingestion half: fetch -> chunk -> embed -> STORE.

import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Document } from "@langchain/core/documents";

import { LocalEmbeddings } from "./embed.ts";
import { chunkGdpr } from "./chunk.ts";

// Load QDRANT_URL / QDRANT_API_KEY from .env into process.env (Node built-in).
process.loadEnvFile();

const COLLECTION = "gdpr";

async function main() {
  // Drop any existing collection first so this script is REPEATABLE. Without
  // this, swapping embedding models (e.g. 384-dim MiniLM -> 768-dim mpnet) would
  // fail: Qdrant rejects vectors whose size doesn't match the existing
  // collection. deleteCollection is a no-op if the collection isn't there.
  const client = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });
  console.log(`Dropping existing "${COLLECTION}" collection (if any)...`);
  await client.deleteCollection(COLLECTION);

  console.log("Chunking GDPR...");
  const chunks = await chunkGdpr();

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

  // One call: creates the collection (size 768, cosine) if missing, embeds
  // every document via LocalEmbeddings, and upserts vectors + metadata.
  await QdrantVectorStore.fromDocuments(documents, new LocalEmbeddings(), {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION,
  });

  console.log(`Done. Stored ${documents.length} chunks in collection "${COLLECTION}".`);
}

main();
