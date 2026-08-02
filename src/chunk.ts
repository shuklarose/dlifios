// Splits an EU act into article-sized, citation-ready chunks.
//
// The EU marks every article with <div id="art_N">, so we split on their
// boundaries rather than by character count. Long articles are sub-split, and
// every piece keeps its article number in metadata, which is what makes the
// citation a property of the chunk rather than something the model reconstructs.
//
// The markup ("oj-"/"eli-" classes) is the EU's standard Official Journal format
// and is shared across acts, so one splitter handles any CELEX id.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CELEX } from "./config.ts";
import { fetchCelexHtml } from "./sources/eurlex.ts";

// The shape every chunk keeps from here to Qdrant. The metadata is what makes a
// precise citation possible later.
export interface Chunk {
  id: string; // e.g. "GDPR_art6_p0", or "GDPR_art4_def7" for a definition
  text: string;
  metadata: {
    source: string;
    celex: string;
    article: number;
    title: string; // e.g. "Lawfulness of processing"
    part: number; // 0, 1, 2... within one article
    definition?: number; // set only for definitions articles - the N in "Article 4(7)"
  };
}

const MAX_CHUNK_CHARS = 1500;

// ---------- Step 1: get the document (disk cache, fetch once) ----------

// Cache each act under data/<celex>.html so we only fetch it from Cellar once.
async function loadCelexHtml(celex: string): Promise<string> {
  const cachePath = `data/${celex}.html`;
  if (existsSync(cachePath)) {
    return readFile(cachePath, "utf8");
  }
  const html = await fetchCelexHtml(celex);
  await mkdir("data", { recursive: true });
  await writeFile(cachePath, html, "utf8");
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

  // Signatures/annexes start at oj-final. If an act lacks that marker,
  // indexOf returns -1 - fall back to the end of the document so the last
  // article isn't truncated.
  const finalBlockRaw = html.indexOf('<div class="oj-final">');
  const finalBlock = finalBlockRaw === -1 ? html.length : finalBlockRaw;

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

// ---------- Step 4b: definitions articles split per definition, not per 1500 chars ----------

// A definitions article is a LIST of independent concepts, and slicing it by
// character count is actively harmful. Measured on GDPR Article 4: the size-based
// splitter produced one chunk holding 'pseudonymisation', 'filing system',
// 'controller' AND 'processor' together, so that chunk's embedding landed at the
// CENTROID of four unrelated concepts - close to none of them. The observable
// result: "What is a data controller?" could not retrieve the chunk that defines
// a controller. It didn't even rank top-20 when the question quoted the
// definition almost word for word.
//
// The EU's markup hands us a better boundary, one level below the id="art_N" we
// already split on: each definition starts with its number alone on a line
// ("(7)"), followed by the text. The counts confirm it's structural, not a guess
// - GDPR Art 4: 26 such lines for 26 definitions; AI Act Art 3: 68 for 68.
//
// Returns null when this ISN'T a definitions list, so the caller falls back to
// the normal size-based splitter.
interface Definition {
  num: number; // the N in "Article 4(7)"
  text: string;
}

function splitDefinitions(body: string, title: string): Definition[] | null {
  if (!/definition/i.test(title)) return null;

  const lines = body.split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (/^\(\d+\)$/.test(line.trim())) starts.push(i);
  });

  // A couple of stray "(1)" lines don't make a definitions list. Require a real
  // run of them before overriding the default splitter.
  if (starts.length < 3) return null;

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    return {
      num: Number(lines[start].trim().slice(1, -1)),
      // Everything after the "(N)" line up to the next one IS the definition.
      text: lines.slice(start + 1, end).join("\n").trim(),
    };
  });
}

// ---------- Step 5: assemble the chunks ----------

// Chunk ANY EU act by CELEX. `source` is a short human label used in the chunk
// id and metadata (e.g. "GDPR"); it defaults to the CELEX for acts we don't
// have a nickname for. Returns one Chunk per article-piece.
export async function chunkCelex(celex: string, source: string = celex): Promise<Chunk[]> {
  const html = await loadCelexHtml(celex);
  const articles = splitArticles(html);
  const chunks: Chunk[] = [];

  for (const art of articles) {
    // Definitions articles take the per-definition path (see splitDefinitions).
    const defs = splitDefinitions(art.body, art.title);
    if (defs) {
      defs.forEach((def, part) => {
        chunks.push({
          id: `${source}_art${art.article}_def${def.num}`,
          // Self-describing: this chunk is embedded and retrieved ALONE, so it has
          // to carry its own citation. "Article 4(7)" is also precisely how a
          // lawyer cites a definition - the sub-number is the whole point.
          text: `Article ${art.article}(${def.num}) - ${art.title}:\n${def.text}`,
          metadata: {
            source,
            celex,
            article: art.article,
            title: art.title,
            part,
            definition: def.num,
          },
        });
      });
      continue;
    }

    const pieces = splitIntoPieces(art.body, MAX_CHUNK_CHARS);

    pieces.forEach((piece, part) => {
      // Continuation pieces lose the heading in the split - re-attach it so
      // every chunk is self-describing when embedded alone.
      const text =
        part === 0 ? piece : `Article ${art.article} - ${art.title} (continued):\n${piece}`;

      chunks.push({
        id: `${source}_art${art.article}_p${part}`,
        text,
        metadata: {
          source,
          celex,
          article: art.article,
          title: art.title,
          part,
        },
      });
    });
  }

  return chunks;
}

// The GDPR is just one act with a friendly name - chunkCelex does the work.
export function chunkGdpr(): Promise<Chunk[]> {
  return chunkCelex(CELEX.GDPR, "GDPR");
}

// ---------- Demo: run with `npm run chunk` ----------

async function demo() {
  const chunks = await chunkGdpr();

  const sizes = chunks.map((c) => c.text.length);
  const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);

  console.log(`Articles found: ${new Set(chunks.map((c) => c.metadata.article)).size}`);
  console.log(`Chunks produced: ${chunks.length}`);
  console.log(`Chunk size - min: ${Math.min(...sizes)}, avg: ${avg}, max: ${Math.max(...sizes)}`);

  const sample = chunks.find((c) => c.id === "GDPR_art6_p0")!;
  console.log(`\n--- sample: ${sample.id} (${sample.metadata.title}) ---`);
  console.log(sample.text.slice(0, 600));
}

// Run the demo ONLY when this file is executed directly (npm run chunk),
// not when store.ts imports chunkGdpr().
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demo();
}
