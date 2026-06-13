// store.ts — Day 6: embed every GDPR chunk and store it in Qdrant.
// This completes the ingestion half: fetch -> chunk -> embed -> STORE.

import { QdrantVectorStore } from "@langchain/qdrant";
import { Embeddings } from "@langchain/core/embeddings";
import { Document } from "@langchain/core/documents";

import { embed, embedMany } from "./embed.ts";
import { chunkGdpr } from "./chunk.ts";

// Load QDRANT_URL / QDRANT_API_KEY from .env into process.env (Node built-in).
process.loadEnvFile();

const COLLECTION = "gdpr";

// Adapter: make our local embedder speak LangChain's "Embeddings" language.
// LangChain calls embedDocuments() for stored texts and embedQuery() for searches.
// Same model both ways — that shared space is what makes retrieval work (Day 7).
class LocalEmbeddings extends Embeddings {
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

async function main() {
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

  // One call: creates the collection (size 384, cosine) if missing, embeds
  // every document via LocalEmbeddings, and upserts vectors + metadata.
  await QdrantVectorStore.fromDocuments(documents, new LocalEmbeddings(), {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION,
  });

  console.log(`Done. Stored ${documents.length} chunks in collection "${COLLECTION}".`);
}

main();
