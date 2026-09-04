import os from 'node:os';
import { performance } from 'node:perf_hooks';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import jotaroProfileJson from '../tests/fixtures/jotaro99-profile.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { buildStrategyCandidates } from '../src/strategy/candidates';
import { validatePlayerProfile } from '../src/profile/import';

function runBenchmark() {
  const data = normalizeStrategyGameData(strategyDataJson);
  const profile = validatePlayerProfile(jotaroProfileJson);

  // 構造具備真實代表性的全市場報價池
  const quotes: Record<string, { a: number; b: number; p: number; v: number }> = {};
  for (const [hrid, item] of data.itemsByHrid) {
    if (item.isTradable) {
      quotes[`${hrid}::0`] = { a: 1000, b: 900, p: 950, v: 10000 };
    }
  }
  const snapshot = { timestamp: 1700000000, quotes };
  const prices = createStrategyPriceBook(snapshot, data);

  console.log('=== Strategy Candidates Benchmark Harness ===');
  console.log('OS:', os.type(), os.release(), os.arch());
  console.log('CPU:', os.cpus()[0]?.model);
  console.log('Node:', process.version);
  console.log('Total items in GameData:', data.itemsByHrid.size);
  console.log('Total actions in GameData:', data.actionsByHrid.size);

  const start = performance.now();
  const result = buildStrategyCandidates({ profile, data, prices });
  const end = performance.now();
  const durationMs = end - start;

  console.log('--- Results ---');
  console.log('Generated Candidates count:', result.candidates.length);
  console.log('Diagnostics count:', result.diagnostics.length);
  console.log('Execution Time:', durationMs.toFixed(2), 'ms');
  console.log('Benchmark Status:', durationMs < 2000 ? 'PASS (< 2000ms)' : 'FAIL (>= 2000ms)');
}

runBenchmark();
