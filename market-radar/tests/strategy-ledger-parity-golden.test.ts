import { describe, expect, it } from 'vitest';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import jotaroProfileJson from './fixtures/jotaro99-profile.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { calculateDecompose } from '../src/strategy/alchemy';
import { validatePlayerProfile } from '../src/profile/import';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const jotaroProfile = validatePlayerProfile(jotaroProfileJson);

const snapshot: Snapshot = {
  timestamp: 1_700_000_000,
  quotes: {
    '/items/holy_milk::0': { a: 960, b: 920, p: 940, v: 50_000 },
    '/items/milking_essence::0': { a: 450, b: 447, p: 448, v: 200_000 },
    '/items/emp_tea_leaf::0': { a: 116, b: 115, p: 115.5, v: 600_000 },
    '/items/brewing_essence::0': { a: 292, b: 290, p: 291, v: 600_000 },
    '/items/ultra_alchemy_tea::0': { a: 10_400, b: 9_800, p: 10_000, v: 5_000 },
    '/items/catalytic_tea::0': { a: 3_320, b: 3_100, p: 3_200, v: 5_000 },
    '/items/efficiency_tea::0': { a: 2_990, b: 2_800, p: 2_900, v: 5_000 },
    '/items/alchemy_essence::0': { a: 700, b: 674, p: 680, v: 10_000 },
    '/items/large_artisans_crate::0': { a: 800_000, b: 787_000, p: 790_000, v: 1_000 },
    '/items/small_artisans_crate::0': { a: 8_000, b: 7_500, p: 7_800, v: 1_000 },
    '/items/medium_artisans_crate::0': { a: 50_000, b: 45_000, p: 48_000, v: 1_000 },
    '/items/bag_of_10_cowbells::0': { a: 1_000, b: 1_000, p: 1_000, v: 1_000 },
    '/items/shard_of_protection::0': { a: 10, b: 10, p: 10, v: 1_000 },
    '/items/mirror_of_protection::0': { a: 15, b: 15, p: 15, v: 1_000 },
    '/items/pearl::0': { a: 20, b: 20, p: 20, v: 1_000 },
    '/items/amber::0': { a: 30, b: 30, p: 30, v: 1_000 },
    '/items/garnet::0': { a: 40, b: 40, p: 40, v: 1_000 },
    '/items/jade::0': { a: 50, b: 50, p: 50, v: 1_000 },
    '/items/amethyst::0': { a: 60, b: 60, p: 60, v: 1_000 },
    '/items/moonstone::0': { a: 70, b: 70, p: 70, v: 1_000 },
  },
};

const prices = createStrategyPriceBook(snapshot, data);

describe('MWI observed mechanics and ledger parity (jotaro99)', () => {
  it('keeps directly observed Holy Milk mechanics separate from derived throughput', () => {
    const result = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    const physical = result.ledger!.physical;

    // OBSERVED in MWI UI for this fixed profile.
    expect(physical.actionTimeSeconds).toBeCloseTo(8.97, 2);
    expect(physical.successRate).toBeCloseTo(0.63, 2);
    expect(physical.outputUnitsPerSuccess['/items/milking_essence']).toBe(20);

    // DERIVED relationships. Do not label the absolute actions/h value as Client-observed.
    expect(physical.successfulActionsPerHour).toBeCloseTo(
      physical.actionsPerHour * physical.successRate,
      4,
    );
    expect(physical.inputUnitsPerHour['/items/holy_milk']).toBeCloseTo(
      physical.actionsPerHour * 2,
      2,
    );
    expect(physical.outputUnitsPerHour['/items/milking_essence']).toBeCloseTo(
      physical.successfulActionsPerHour * 20,
      2,
    );
  });

  it('locks the user-observed Emp Tea Leaf result at 20 Brewing Essence per successful action', () => {
    const result = calculateDecompose({
      itemHrid: '/items/emp_tea_leaf',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    const physical = result.ledger!.physical;

    // OBSERVED directly by the user in MWI on 2026-09-04.
    expect(jotaroProfile.actions.alchemy.playerLevel).toBe(110);
    expect(physical.actionTimeSeconds).toBeCloseTo(8.97, 2);
    expect(physical.successRate).toBeCloseTo(0.63, 2);
    expect(physical.outputUnitsPerSuccess['/items/brewing_essence']).toBe(20);

    expect(physical.outputUnitsPerHour['/items/brewing_essence']).toBeCloseTo(
      physical.successfulActionsPerHour * 20,
      2,
    );
    expect(physical.inputUnitsPerHour['/items/emp_tea_leaf']).toBeCloseTo(
      physical.actionsPerHour * 2,
      2,
    );
  });

  it('keeps the Physical Ledger independent from missing market prices', () => {
    const emptyPrices = createStrategyPriceBook({ timestamp: snapshot.timestamp, quotes: {} }, data);
    const normal = calculateDecompose({
      itemHrid: '/items/holy_milk', catalystRank: 0, enhancementLevel: 0,
      profile: jotaroProfile, data, prices,
    });
    const unpriced = calculateDecompose({
      itemHrid: '/items/holy_milk', catalystRank: 0, enhancementLevel: 0,
      profile: jotaroProfile, data, prices: emptyPrices,
    });

    expect(unpriced.ledger!.economic.complete).toBe(false);
    expect(unpriced.ledger!.economic.profitPerDay).toBeNull();
    expect(unpriced.ledger!.physical).toEqual(normal.ledger!.physical);
  });

  it('reconciles economic revenue from per-output valuations without mutating Physical Ledger', () => {
    const result = calculateDecompose({
      itemHrid: '/items/holy_milk', catalystRank: 0, enhancementLevel: 0,
      profile: jotaroProfile, data, prices,
    });
    const economic = result.ledger!.economic;
    const expectedRevenue = Object.values(economic.outputValuations)
      .reduce((sum, value) => sum + (value.netValuePerHour ?? 0), 0);

    expect(economic.complete).toBe(true);
    expect(economic.revenuePerHour).toBeCloseTo(expectedRevenue, 4);
    expect(economic.profitPerHour).toBeCloseTo(
      economic.revenuePerHour! - economic.costPerHour!,
      4,
    );
  });
});
