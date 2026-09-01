import exporter from './fixtures/profile-export-v1.json';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { calculateCoinify, calculateDecompose } from '../src/strategy/alchemy';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createMarketPriceBook } from '../src/strategy/price-book';
import { calculateWorkflow } from '../src/strategy/workflow';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = importPlayerProfile(JSON.stringify(exporter), 0);

function prices(missingPirateEssenceAsk = false) {
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
      '/items/large_artisans_crate::0': { a: 1_100_000, b: 1_000_000, p: 1_050_000, v: 100 },
    },
  };
  return createMarketPriceBook(snapshot);
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
    expect(none.outputs.find((flow) => flow.itemHrid === '/items/large_artisans_crate')?.market).toBe(false);
    expect(none.incomePerHour).toBeCloseTo(none.outputs.reduce((sum, flow) => (
      sum + flow.unitsPerHour * flow.unitPrice! * 0.95
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
});
