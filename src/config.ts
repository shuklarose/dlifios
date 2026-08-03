// Every external endpoint and tunable constant. No other file hardcodes a URL.

// EU publication servers reject requests without a User-Agent.
export const USER_AGENT = "DlifiosBot/1.0 (+https://github.com/roseshukla; roseshukla222@gmail.com)";

// Cellar serves full document text. The response format is chosen by the Accept
// header, not the URL: http://publications.europa.eu/resource/celex/{CELEX}
export const CELLAR_BASE = "http://publications.europa.eu/resource/celex/";
export const ACCEPT_HTML = "application/xhtml+xml";

// SPARQL answers "what was published recently".
export const SPARQL_ENDPOINT = "http://publications.europa.eu/webapi/rdf/sparql";

// EuroVoc concept id for "data protection", used to filter new acts to our domain.
export const EUROVOC_DATA_PROTECTION = "2191";

export const EDPB_RSS_URL = "https://www.edpb.europa.eu/rss.xml";

export const CELEX = {
  GDPR: "32016R0679",
  AI_ACT: "32024R1689",
};

// Generation model, swappable from the environment so trying a different one is
// a config change and a restart rather than a code change and a deploy.
//
// The default is 2.5-flash rather than 3.5-flash because on the free tier
// 3.5-flash returns 503 "high demand" for most calls, and LangChain's
// exponential backoff turns those into multi-minute hangs instead of clean
// failures.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// Defaults to 0. Faithfulness to the retrieved passages matters more than
// fluency here, and a legal citation is not improved by variation. Raise it
// only to see how much the wording drifts, and check the citations still match
// what was retrieved before leaving it raised.
//
// Number(undefined) is NaN rather than a default, so the guard matters: an
// unset or malformed value falls back to 0 instead of reaching the API as NaN.
const parsedTemperature = Number(process.env.GEMINI_TEMPERATURE);
export const GEMINI_TEMPERATURE = Number.isFinite(parsedTemperature) ? parsedTemperature : 0;

// Embedding model, deliberately NOT read from the environment.
//
// Changing it invalidates the whole index. Vectors from a different model live
// in a different space, so old and new remain numerically comparable while
// being semantically unrelated, and retrieval starts returning confident
// nonsense rather than failing. A different output dimension is the lucky case:
// Qdrant rejects the write outright.
//
// Swapping it means editing this line and rebuilding: `npm run store`, which
// drops the collection and re-embeds every passage. Keeping it out of the
// environment keeps that from looking like a restart-safe toggle.
export const EMBEDDING_MODEL = "Xenova/all-mpnet-base-v2";

// One collection holds every act. Chunks carry source/celex/article in metadata,
// so a single query searches the whole corpus.
export const COLLECTION = "eu_law";
