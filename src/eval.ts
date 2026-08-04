// Measures retrieval, not generation. No model calls, so this can run as often
// as needed and says nothing about how the answer was worded, only about
// whether the right law reached the prompt in the first place.
//
// Two metrics:
//   hit rate at k   did the expected article appear anywhere in the top k
//   MRR             1/rank of the expected article, averaged
//
// Hit rate answers "was it found". MRR answers "was it found first", which
// matters because the model reads the passages in order and the top result
// carries the most weight.

import { fileURLToPath } from "node:url";

import { search } from "./retrieve.ts";
import { EVAL_SET, type EvalCase } from "./eval-set.ts";
import "./env.ts";

const K = Number(process.env.EVAL_K ?? 5);

interface Result {
  testCase: EvalCase;
  rank: number | null;
  retrieved: string[];
}

async function evaluate(testCase: EvalCase): Promise<Result> {
  const hits = await search(testCase.question, K);

  const retrieved = hits.map(([doc]) => `${doc.metadata.source} ${doc.metadata.article}`);
  const position = hits.findIndex(
    ([doc]) =>
      doc.metadata.source === testCase.act && Number(doc.metadata.article) === testCase.article,
  );

  return { testCase, rank: position === -1 ? null : position + 1, retrieved };
}

async function run(): Promise<void> {
  console.log(`Evaluating retrieval over ${EVAL_SET.length} questions at k=${K}\n`);

  const results: Result[] = [];
  for (const testCase of EVAL_SET) {
    results.push(await evaluate(testCase));
  }

  const hits = results.filter((r) => r.rank !== null);
  const top1 = results.filter((r) => r.rank === 1);
  const mrr = results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / results.length;

  const misses = results.filter((r) => r.rank === null);
  if (misses.length) {
    console.log("Misses:\n");
    for (const m of misses) {
      console.log(`  ${m.testCase.question}`);
      console.log(`    expected ${m.testCase.act} ${m.testCase.article}`);
      console.log(`    returned ${m.retrieved.join(", ")}\n`);
    }
  }

  const ranked = results.filter((r) => r.rank !== null && r.rank > 1);
  if (ranked.length) {
    console.log("Found, but not first:\n");
    for (const r of ranked) {
      console.log(`  rank ${r.rank}  ${r.testCase.act} ${r.testCase.article}  ${r.testCase.question}`);
    }
    console.log("");
  }

  const pct = (n: number) => ((n / results.length) * 100).toFixed(0);
  console.log(`hit rate @${K}   ${pct(hits.length)}%  (${hits.length}/${results.length})`);
  console.log(`top-1 accuracy  ${pct(top1.length)}%  (${top1.length}/${results.length})`);
  console.log(`MRR             ${mrr.toFixed(3)}`);

  // Non-zero exit on a regression, so this can gate a deploy later.
  const threshold = Number(process.env.EVAL_MIN_HIT_RATE ?? 0);
  if (threshold && hits.length / results.length < threshold) {
    console.error(`\nBelow the required hit rate of ${threshold}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
