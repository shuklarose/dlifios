// chunk.ts — Day 4: split the GDPR into article-sized, citation-ready chunks.
// Strategy: the EU already marks every article with <div ... id="art_N">,
// so we split on THEIR boundaries instead of guessing. Long articles get
// sub-split, but every piece keeps its article number as metadata.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CELEX } from "./config.ts";
import { fetchCelexHtml } from "./sources/eurlex.ts";

// The shape every chunk has from here to Qdrant. The metadata is what
// makes Day-8 citations possible ("per Article 6(1)(a) GDPR").
export interface Chunk {
  id: string; // e.g. "GDPR_art6_p0"
  text: string; // what gets embedded on Day 5
  metadata: {
    source: string;
    celex: string;
    article: number;
    title: string; // e.g. "Lawfulness of processing"
    part: number; // 0, 1, 2... within one article
  };
}

const CACHE_PATH = "data/gdpr.html";
const MAX_CHUNK_CHARS = 1500;

// ---------- Step 1: get the document (disk cache, fetch once) ----------

async function loadGdprHtml(): Promise<string> {
  if (existsSync(CACHE_PATH)) {
    return readFile(CACHE_PATH, "utf8");
  }
  const html = await fetchCelexHtml(CELEX.GDPR);
  await mkdir("data", { recursive: true });
  await writeFile(CACHE_PATH, html, "utf8");
  return html;
}

// ---------- Step 2: HTML -> plain text ----------

function htmlToText(html: string): string {
  return html
    .replace(/<\/p>/g, "\n") // paragraph ends become line breaks
    .replace(/<[^>]+>/g, " ") // every other tag vanishes
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ") // squash runs of spaces
    .replace(/\s*\n\s*/g, "\n") // tidy blank space around line breaks
    .trim();
}

// ---------- Step 3: slice the document into articles ----------

interface ArticleSection {
  article: number;
  title: string;
  body: string; // plain text, includes the "Article N" heading
}

function splitArticles(html: string): ArticleSection[] {
  const markers = [...html.matchAll(/<div class="eli-subdivision" id="art_(\d+)">/g)];
  const finalBlock = html.indexOf('<div class="oj-final">'); // signatures start here

  return markers.map((marker, i) => {
    const start = marker.index!;
    const end = i + 1 < markers.length ? markers[i + 1].index! : finalBlock;
    const slice = html.slice(start, end);

    const titleMatch = slice.match(/<p class="oj-sti-art">(.*?)<\/p>/);

    return {
      article: Number(marker[1]),
      title: titleMatch ? htmlToText(titleMatch[1]) : "",
      body: htmlToText(slice),
    };
  });
}

// ---------- Step 4: sub-split long articles on paragraph boundaries ----------

function splitIntoPieces(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    // +1 for the newline we'd add back
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      pieces.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) pieces.push(current);

  return pieces;
}

// ---------- Step 5: assemble the chunks ----------

export async function chunkGdpr(): Promise<Chunk[]> {
  const html = await loadGdprHtml();
  const articles = splitArticles(html);
  const chunks: Chunk[] = [];

  for (const art of articles) {
    const pieces = splitIntoPieces(art.body, MAX_CHUNK_CHARS);

    pieces.forEach((piece, part) => {
      // Continuation pieces lose the heading in the split — re-attach it so
      // every chunk is self-describing when embedded alone.
      const text =
        part === 0 ? piece : `Article ${art.article} — ${art.title} (continued):\n${piece}`;

      chunks.push({
        id: `GDPR_art${art.article}_p${part}`,
        text,
        metadata: {
          source: "GDPR",
          celex: CELEX.GDPR,
          article: art.article,
          title: art.title,
          part,
        },
      });
    });
  }

  return chunks;
}

// ---------- Demo: run with `npm run chunk` ----------

const chunks = await chunkGdpr();

const sizes = chunks.map((c) => c.text.length);
const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);

console.log(`Articles found: ${new Set(chunks.map((c) => c.metadata.article)).size}`);
console.log(`Chunks produced: ${chunks.length}`);
console.log(`Chunk size — min: ${Math.min(...sizes)}, avg: ${avg}, max: ${Math.max(...sizes)}`);

const sample = chunks.find((c) => c.id === "GDPR_art6_p0")!;
console.log(`\n--- sample: ${sample.id} (${sample.metadata.title}) ---`);
console.log(sample.text.slice(0, 600));
