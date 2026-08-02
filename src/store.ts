// The end of the ingestion path: fetch -> chunk -> embed -> store.
//
// ingestCelex(celex, source) adds any act to the shared collection and is what
// the monitor calls for each newly discovered act. The reset flag drops and
// rebuilds instead, which is the path for a full reindex or an embedding swap.

import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Document } from "@langchain/core/documents";
import { fileURLToPath } from "node:url";

import { LocalEmbeddings } from "./embed.ts";
import { chunkCelex } from "./chunk.ts";
import { CELEX, COLLECTION } from "./config.ts";

// Load QDRANT_URL / QDRANT_API_KEY from .env into process.env (Node built-in).
process.loadEnvFile();

// One place that builds the raw Qdrant client (for ops LangChain doesn't wrap:
// delete collection, payload index, filtered scroll).
function qdrant(): QdrantClient {
  return new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });
}

// hasCelex() filters on this field, and Qdrant REQUIRES a payload index to
// filter - without it the filter errors. We (re)create the index after every
// upsert, because a reset drops the collection and its indexes with it.
async function ensureCelexIndex(client: QdrantClient): Promise<void> {
  try {
    await client.createPayloadIndex(COLLECTION, {
      field_name: "metadata.celex",
      field_schema: "keyword",
    });
  } catch {
    // Already exists - Qdrant rejects a duplicate index; that's fine.
  }
}

// Embed one act (by CELEX) and store its chunks in the shared collection.
//   - reset:false (default) ADDS the act to whatever's already there - this is
//     what the daily monitor wants when a NEW act appears.
//   - reset:true DROPS the collection first, for a clean full rebuild (e.g.
//     after swapping the embedding model, where vector size changes).
// Returns how many chunks were stored.
export async function ingestCelex(
  celex: string,
  source: string = celex,
  opts: { reset?: boolean } = {}
): Promise<number> {
  const client = qdrant();

  if (opts.reset) {
    // deleteCollection is a no-op if it doesn't exist. Qdrant rejects vectors
    // whose size doesn't match an existing collection, so a reset is required
    // when the embedding dimension changes (384-dim MiniLM -> 768-dim mpnet).
    console.log(`Resetting collection "${COLLECTION}"...`);
    await client.deleteCollection(COLLECTION);
  }

  console.log(`Chunking ${source} (${celex})...`);
  const chunks = await chunkCelex(celex, source);

  // LangChain stores "Documents": pageContent (the text to embed) + metadata
  // (rides along, returned with search hits - this is what powers citations).
  const documents = chunks.map(
    (c) =>
      new Document({
        pageContent: c.text,
        metadata: { ...c.metadata, chunkId: c.id },
      })
  );

  // Not every act has article markup (decisions, corrigenda, etc.). With no
  // chunks there's nothing to embed - bail cleanly so the monitor can skip it.
  if (documents.length === 0) {
    console.log(`No article structure in ${source} (${celex}) - nothing stored.`);
    return 0;
  }

  console.log(`Embedding ${documents.length} chunks and upserting to Qdrant...`);

  // fromDocuments creates the collection (size 768, cosine) if missing, embeds
  // every document via LocalEmbeddings, and upserts. If the collection already
  // exists it ADDS to it - that's how new acts join the corpus.
  await QdrantVectorStore.fromDocuments(documents, new LocalEmbeddings(), {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION,
  });

  // The collection now exists for sure - make metadata.celex filterable so
  // hasCelex() works (idempotent dedup for the daily monitor).
  await ensureCelexIndex(client);

  console.log(`Done. Stored ${documents.length} chunks from ${source} in "${COLLECTION}".`);
  return documents.length;
}

// The base corpus: a clean rebuild of the collection from the GDPR.
export function ingestGdpr(): Promise<number> {
  return ingestCelex(CELEX.GDPR, "GDPR", { reset: true });
}

// Is this act already in the corpus? The monitor uses this to stay idempotent -
// it skips acts it has already ingested instead of creating duplicate chunks.
// We ask Qdrant for a single point whose metadata.celex matches; one hit = yes.
export async function hasCelex(celex: string): Promise<boolean> {
  try {
    const res = await qdrant().scroll(COLLECTION, {
      filter: { must: [{ key: "metadata.celex", match: { value: celex } }] },
      limit: 1,
      with_payload: false,
      with_vector: false,
    });
    return res.points.length > 0;
  } catch {
    // Collection doesn't exist yet -> nothing is ingested.
    return false;
  }
}

// Run a full GDPR rebuild ONLY when executed directly (npm run store),
// not when server.ts imports these functions.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ingestGdpr();
}
