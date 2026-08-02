// Every external endpoint and tunable constant. No other file hardcodes a URL.

// EU publication servers reject requests without a User-Agent.
export const USER_AGENT = "DlifiosBot/1.0 (+https://github.com/roseshukla; roseshukla222@gmail.com)";

// Cellar serves full document text. The response format is chosen by the Accept
// header, not the URL: http://publications.europa.eu/resource/celex/{CELEX}
export const CELLAR_BASE = "http://publications.europa.eu/resource/celex/";
export const ACCEPT_HTML = "application/xhtml+xml";
export const ACCEPT_FORMEX = "application/xml;notice=branch";

// SPARQL answers "what was published recently".
export const SPARQL_ENDPOINT = "http://publications.europa.eu/webapi/rdf/sparql";

// EuroVoc concept id for "data protection", used to filter new acts to our domain.
export const EUROVOC_DATA_PROTECTION = "2191";

export const EDPB_RSS_URL = "https://www.edpb.europa.eu/rss.xml";

export const CELEX = {
  GDPR: "32016R0679",
  AI_ACT: "32024R1689",
};

// 2.5-flash rather than 3.5-flash: on the free tier 3.5-flash returns 503 "high
// demand" for most calls, and LangChain's exponential backoff turns those into
// multi-minute hangs instead of clean failures.
export const GEMINI_MODEL = "gemini-2.5-flash";

// One collection holds every act. Chunks carry source/celex/article in metadata,
// so a single query searches the whole corpus.
export const COLLECTION = "eu_law";
