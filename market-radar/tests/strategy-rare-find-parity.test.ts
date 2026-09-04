import { describe, expect, it } from 'vitest';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import jotaroProfileJson from './fixtures/jotaro99-profile.json';
import { validatePlayerProfile } from '../src/profile/import';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { actionBuffs } from '../src/strategy/buffs';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { calculateDecompose } from '../src/strategy/alchemy';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = validatePlayerProfile(jotaroProfileJson);

describe('jotaro99 Rare Find parity against MK runtime evidence', () => {
  it('matches the MK runtime RareFind aggregation of 0.3853', () => {
    const totalHouseLevels = Object.values(profile.actions)
      .reduce((sum, action) => sum + action.houseLevel, 0);

    expect(totalHouseLevels).toBe(24);
    expect(profile.specialEquipment.ring).toEqual({
      itemHrid: '/items/ring_of_rare_find',
      enhancementLevel: 0,
    });

    const buffs = actionBuffs(profile, 'alchemy', data);

    // MK runtime evidence captured 2026-09-05:
    // Alchemist's Top +7 = 0.1773
    // Earrings of Rare Find +0 = 0.08
    // Ring of Rare Find +0 = 0.08
    // All 10 skilling houses, total level 24 = 24 * 0.002 = 0.048
    expect(buffs.RareFind).toBeCloseTo(0.3853, 10);
  });

  it('reproduces the MK Holy Milk large-artisan-crate throughput', () => {
    const emptySnapshot: Snapshot = { timestamp: 0, quotes: {} };
    const prices = createStrategyPriceBook(emptySnapshot, data);
    const result = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile,
      data,
      prices,
    });

    const physical = result.ledger!.physical;
    expect(physical.actionsPerHour).toBeCloseTo(824.260075, 5);
    expect(physical.rareAndEssenceUnitsPerHour['/items/large_artisans_crate'])
      .toBeCloseTo(0.436122, 5);
  });
});
