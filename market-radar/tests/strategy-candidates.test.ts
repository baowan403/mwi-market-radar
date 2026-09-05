import exporter from './fixtures/profile-export-v1.json';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { buildStrategyCandidates } from '../src/strategy/candidates';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = importPlayerProfile(JSON.stringify(exporter), 0);

const snapshot: Snapshot = {
  timestamp: 1,
  quotes: {
    '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
    '/items/redwood_lumber::0': { a: 320, b: 300, p: 310, v: 5_000 },
    '/items/ginkgo_bow::0': { a: 25_000, b: 23_000, p: 24_000, v: 800 },
    '/items/redwood_bow::0': { a: 60_000, b: 55_000, p: 57_500, v: 500 },
    '/items/crafting_essence::0': { a: 1_100, b: 1_000, p: 1_050, v: 1_000 },
    '/items/branch_of_insight::0': { a: 1_100_000, b: 1_000_000, p: 1_050_000, v: 10 },
    '/items/medium_artisans_crate::0': { a: 550_000, b: 500_000, p: 525_000, v: 50 },
    '/items/pirate_refinement_shard::0': { a: 220_000, b: 210_000, p: 215_000, v: 100 },
    '/items/pirate_essence::0': { a: 700, b: 650, p: 675, v: 100_000 },
    '/items/catalyst_of_decomposition::0': { a: 10_000, b: 9_000, p: 9_500, v: 1_000 },
    '/items/catalyst_of_coinification::0': { a: 11_000, b: 10_000, p: 10_500, v: 1_000 },
    '/items/prime_catalyst::0': { a: 20_000, b: 19_000, p: 19_500, v: 1_000 },
    '/items/ultra_alchemy_tea::0': { a: 5_000, b: 4_500, p: 4_750, v: 1_000 },
    '/items/efficiency_tea::0': { a: 2_000, b: 1_800, p: 1_900, v: 1_000 },
    '/items/catalytic_tea::0': { a: 3_000, b: 2_800, p: 2_900, v: 1_000 },
    '/items/alchemy_essence::0': { a: 2_000, b: 1_800, p: 1_900, v: 10_000 },
    '/items/emp_tea_leaf::0': { a: 116, b: 115, p: 115.5, v: 600_000 },
    '/items/brewing_essence::0': { a: 292, b: 290, p: 291, v: 600_000 },
    '/items/bag_of_10_cowbells::0': { a: 1_000, b: 1_000, p: 1_000, v: 1_000 },
    '/items/shard_of_protection::0': { a: 10, b: 10, p: 10, v: 1_000 },
    '/items/mirror_of_protection::0': { a: 15, b: 15, p: 15, v: 1_000 },
    '/items/pearl::0': { a: 20, b: 20, p: 20, v: 1_000 },
    '/items/amber::0': { a: 30, b: 30, p: 30, v: 1_000 },
    '/items/garnet::0': { a: 40, b: 40, p: 40, v: 1_000 },
    '/items/jade::0': { a: 50, b: 50, p: 50, v: 1_000 },
    '/items/amethyst::0': { a: 60, b: 60, p: 60, v: 1_000 },
    '/items/moonstone::0': { a: 70, b: 70, p: 70, v: 1_000 },
    '/items/woodcutting_essence::0': { a: 500, b: 450, p: 475, v: 10_000 },
    '/items/medium_meteorite_cache::0': { a: 100_000, b: 90_000, p: 95_000, v: 10 },
    '/items/cowbell::0': { a: 50, b: 40, p: 45, v: 10_000 },
    '/items/star_fragment::0': { a: 200, b: 180, p: 190, v: 50_000 },
  },
};

describe('personalized strategy candidate enumeration', () => {
  it('finds manufacturing, workflows, and decompose-to-coinify without duplicate ids', () => {
    const result = buildStrategyCandidates({
      profile,
      data,
      prices: createStrategyPriceBook(snapshot, data),
    });

    expect(result.candidates.some((item) => item.kind === 'manufacture'
      && item.path.includes('/items/redwood_lumber'))).toBe(true);
    expect(result.candidates.some((item) => item.kind === 'workflow'
      && item.path.includes('/items/redwood_bow'))).toBe(true);
    expect(result.candidates.some((item) => item.kind === 'decompose-coinify'
      && item.path.includes('/items/pirate_refinement_shard'))).toBe(true);
    const voidTea = result.candidates.find((item) => item.kind === 'decompose'
      && item.steps[0]?.inputs.some((flow) => flow.itemHrid === '/items/emp_tea_leaf'));
    expect(voidTea?.path).toEqual(['/items/emp_tea_leaf', '/items/brewing_essence']);
    const teaFeedstocks = result.candidates.filter((item) => item.steps.length === 1
      && item.steps[0]?.action === 'alchemy'
      && item.steps[0]?.inputs[0]?.itemHrid.endsWith('_tea'));
    expect(teaFeedstocks.length).toBeGreaterThan(0);
    for (const item of teaFeedstocks) {
      expect(item.path[0]).toBe(item.steps[0]!.inputs[0]!.itemHrid);
    }
    expect(new Set(result.candidates.map((item) => item.id)).size).toBe(result.candidates.length);
    const gatheringCandidates = result.candidates.filter((item) => item.kind === 'gather');
    expect(gatheringCandidates.length).toBeGreaterThan(0);
    for (const gatherItem of gatheringCandidates) {
      expect(gatherItem.path.some((hrid) => hrid.includes('_tea') || hrid.includes('_coffee'))).toBe(false);
    }
    expect(result.candidates.map((item) => item.profitPerDay)).toEqual(
      [...result.candidates.map((item) => item.profitPerDay)].sort((left, right) => right - left),
    );
  });

  it('finishes a full-data scan within acceptable time budget', () => {
    const started = performance.now();
    buildStrategyCandidates({ profile, data, prices: createStrategyPriceBook(snapshot, data) });
    // 本機通常 < 1,000ms，放寬至 5,000ms 容許 GitHub Actions 雲端虛擬機 (2 vCPU) 的負載波動
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
