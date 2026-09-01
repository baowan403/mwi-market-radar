import exporter from './fixtures/profile-export-v1.json';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { calculateCoinify, calculateDecompose } from '../src/strategy/alchemy';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { calculateWorkflow } from '../src/strategy/workflow';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = importPlayerProfile(JSON.stringify(exporter), 0);

function prices(missingPirateEssenceAsk = false, missingMoonstone = false) {
  const snapshot: Snapshot = {
    timestamp: 1,
    quotes: {
      '/items/pirate_refinement_shard::0': { a: 220_000, b: 210_000, p: 215_000, v: 100 },
      '/items/pirate_essence::0': { a: missingPirateEssenceAsk ? null : 700, b: 650, p: 675, v: 100_000 },
      '/items/catalyst_of_decomposition::0': { a: 10_000, b: 9_000, p: 9_500, v: 1_000 },
      '/items/catalyst_of_coinification::0': { a: 11_000, b: 10_000, p: 10_500, v: 1_000 },
      '/items/prime_catalyst::0': { a: 20_000, b: 19_000, p: 19_500, v: 1_000 },
      '/items/ultra_alchemy_tea::0': { a: 5_000, b: 4_500, p: 4_750, v: 1_000 },
      '/items/efficiency_tea::0': { a: 2_000, b: 1_800, p: 1_900, v: 1_000 },
      '/items/catalytic_tea::0': { a: 3_000, b: 2_800, p: 2_900, v: 1_000 },
      '/items/alchemy_essence::0': { a: 2_000, b: 1_800, p: 1_900, v: 10_000 },
      '/items/bag_of_10_cowbells::0': { a: 1_000, b: 1_000, p: 1_000, v: 1_000 },
      '/items/shard_of_protection::0': { a: 10, b: 10, p: 10, v: 1_000 },
      '/items/mirror_of_protection::0': { a: 15, b: 15, p: 15, v: 1_000 },
      '/items/pearl::0': { a: 20, b: 20, p: 20, v: 1_000 },
      '/items/amber::0': { a: 30, b: 30, p: 30, v: 1_000 },
      '/items/garnet::0': { a: 40, b: 40, p: 40, v: 1_000 },
      '/items/jade::0': { a: 50, b: 50, p: 50, v: 1_000 },
      '/items/amethyst::0': { a: 60, b: 60, p: 60, v: 1_000 },
      '/items/moonstone::0': { a: 70, b: missingMoonstone ? null : 70, p: 70, v: 1_000 },
    },
  };
  return createStrategyPriceBook(snapshot, data);
}

describe('Milkonomy-compatible alchemy', () => {
  it('increases decompose success with dedicated and prime catalysts', () => {
    const none = calculateDecompose({
      itemHrid: '/items/pirate_refinement_shard', catalystRank: 0, enhancementLevel: 0,
      profile, data, prices: prices(),
    });
    const dedicated = calculateDecompose({
      itemHrid: '/items/pirate_refinement_shard', catalystRank: 1, enhancementLevel: 0,
      profile, data, prices: prices(),
    });
    const prime = calculateDecompose({
      itemHrid: '/items/pirate_refinement_shard', catalystRank: 2, enhancementLevel: 0,
      profile, data, prices: prices(),
    });

    expect(none.valid).toBe(true);
    expect(none.outputHrid).toBe('/items/pirate_essence');
    expect(dedicated.successRate).toBeGreaterThan(none.successRate);
    expect(prime.successRate).toBeGreaterThan(dedicated.successRate);
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/pirate_essence')?.market).toBe(true);
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/alchemy_essence')?.market).toBe(true);
    expect(none.outputs.some((flow) => flow.itemHrid === '/items/large_artisans_crate')).toBe(false);
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/coin')?.market).toBe(false);
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/cowbell')?.market).toBe(false);
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/moonstone')?.market).toBe(true);
    expect(none.incomePerHour).toBeCloseTo(none.outputs.reduce((sum, flow) => (
      sum + flow.unitsPerHour * flow.unitPrice! * (flow.market ? 0.95 : 1)
    ), 0));
  });

  it('coinifies to untaxed coins and composes decompose to coinify', () => {
    const decompose = calculateDecompose({
      itemHrid: '/items/pirate_refinement_shard', catalystRank: 2, enhancementLevel: 0,
      profile, data, prices: prices(),
    });
    const coinify = calculateCoinify({
      itemHrid: '/items/pirate_essence', catalystRank: 2,
      profile, data, prices: prices(),
    });
    const coinFlow = coinify.outputs.find((flow) => flow.itemHrid === '/items/coin');
    const workflow = calculateWorkflow([decompose, coinify]);

    expect(coinify.valid).toBe(true);
    expect(coinFlow?.market).toBe(false);
    expect(coinify.incomePerHour).toBeGreaterThanOrEqual(coinFlow!.unitsPerHour);
    expect(workflow.valid).toBe(true);
    expect(workflow.inputs.some((flow) => flow.itemHrid === '/items/pirate_essence')).toBe(false);
    expect(workflow.outputs.some((flow) => flow.itemHrid === '/items/pirate_essence')).toBe(false);
    expect(workflow.outputs.some((flow) => flow.itemHrid === '/items/coin')).toBe(true);
  });

  it('fails closed when a required ask is absent', () => {
    const result = calculateCoinify({
      itemHrid: '/items/pirate_essence', catalystRank: 0,
      profile, data, prices: prices(true),
    });
    expect(result.valid).toBe(false);
    expect(result.profitPerHour).toBeNull();
  });

  it('fails closed instead of using partial rare-crate value when one leaf quote is absent', () => {
    const result = calculateDecompose({
      itemHrid: '/items/pirate_refinement_shard', catalystRank: 0, enhancementLevel: 0,
      profile, data, prices: prices(false, true),
    });

    expect(result.valid).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.incomePerHour).toBeNull();
    expect(result.profitPerHour).toBeNull();
  });
});
