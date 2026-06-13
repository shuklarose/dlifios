// probe.ts — Day 3: prove the data source works.
// Fetches the full text of the GDPR live from the EU's Cellar service
// and prints evidence: HTTP status, content type, size, and a text sample.

import { CELLAR_BASE, CELEX, ACCEPT_HTML, USER_AGENT } from "./config.ts";
import { findNewActs } from "./sources/eurlex.ts";
import { fetchEdpbItems } from "./sources/edpb.ts";

// ============ Probe 1: Cellar full-text fetch ============

const url = CELLAR_BASE + CELEX.GDPR;

console.log("Fetching GDPR from Cellar...");
console.log("URL:", url);

const response = await fetch(url, {
  headers: {
    Accept: ACCEPT_HTML,
    "Accept-Language": "en",
    "User-Agent": USER_AGENT,
  },
});

console.log("Status:", response.status, response.statusText);
console.log("Content-Type:", response.headers.get("content-type"));

if (!response.ok) {
  console.error("Request failed — body starts with:");
  console.error((await response.text()).slice(0, 500));
  process.exit(1);
}

const text = await response.text();

console.log("Characters received:", text.length.toLocaleString());
console.log("--- sample (chars 5000–6000) ---");
console.log(text.slice(5000, 6000));

// ============ Probe 2: SPARQL change detection ============

// "Since 180 days ago" — EU data-protection acts arrive in bursts with quiet
// months between (we verified: nothing published April–June 2026), so the probe
// looks back far enough to always have something to show.
const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

console.log(`\nAsking SPARQL: new data-protection acts since ${since}...`);

const acts = await findNewActs(since);

console.log(`Found ${acts.length} act(s):`);
for (const act of acts) {
  console.log(`- [${act.date}] ${act.celex} — ${act.title.slice(0, 90)}`);
}

// ============ Probe 3: EDPB RSS feed ============

console.log("\nFetching EDPB guidance feed...");

const items = await fetchEdpbItems();

console.log(`Found ${items.length} feed item(s); newest 5:`);
for (const item of items.slice(0, 5)) {
  console.log(`- [${item.date}] ${item.title}`);
  console.log(`  ${item.link}`);
}
