// config.ts — every endpoint and constant in one place.
// Rule: no other file hardcodes a URL. If the EU moves an endpoint, we change one line here.

// ---- Identity ----
// EU servers reject anonymous requests, so every fetch sends this header.
export const USER_AGENT = "DlifiosBot/0.1 (learning project; roseshukla222@gmail.com)";

// ---- Cellar: full-text document store ----
// Pattern: http://publications.europa.eu/resource/celex/{CELEX}
// The format you get back is decided by the Accept header (content negotiation),
// not by the URL.
export const CELLAR_BASE = "http://publications.europa.eu/resource/celex/";

// Accept headers for the two formats we care about:
export const ACCEPT_HTML = "application/xhtml+xml"; // human-shaped full text
export const ACCEPT_FORMEX = "application/xml;notice=branch"; // article-structured XML

// ---- SPARQL: the "what's new?" endpoint ----
export const SPARQL_ENDPOINT = "http://publications.europa.eu/webapi/rdf/sparql";

// EuroVoc concept id for "data protection" — used to filter new acts to our domain.
export const EUROVOC_DATA_PROTECTION = "2191";

// ---- EDPB: soft-law guidance feed ----
export const EDPB_RSS_URL = "https://www.edpb.europa.eu/rss.xml";

// ---- Known documents (CELEX ids) ----
export const CELEX = {
  GDPR: "32016R0679",
  AI_ACT: "32024R1689", // stretch corpus, not ingested until the loop works
};

// ---- Vector store ----
// ONE shared collection holds the whole data-protection corpus (GDPR + any act
// the monitor ingests). Each chunk carries its source/celex/article in metadata,
// so cross-act questions search everything at once. store.ts + retrieve.ts
// import this so the name lives in exactly one place.
export const COLLECTION = "eu_law";
