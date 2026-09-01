import exporter from './fixtures/profile-export-v1.json';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { calculateManufactureAction } from '../src/strategy/manufacture-adapter';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createMarketPriceBook } from '../src/strategy/price-book';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = importPlayerProfile(JSON.stringify(exporter), 0);

function prices(outputBid: number | null = 300) {
  const snapshot: Snapshot = {
    timestamp: 1,
    quotes: {
      '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
      '/items/redwood_lumber::0': { a: 320, b: outputBid, p: 310, v: 5_000 },
      '/items/crafting_essence::0': { a: 1_100, b: 1_000, p: 1_050, v: 1_000 },
      '/items/branch_of_insight::0': { a: 1_100_000, b: 1_000_000, p: 1_050_000, v: 10 },
      '/items/medium_artisans_crate::0': { a: 550_000, b: 500_000, p: 525_000, v: 50 },
    },
  };
  return createMarketPriceBook(snapshot);
}

describe('real manufacturing recipe adapter', () => {
  it('calculates a real redwood lumber recipe with profile buffs and drop EV', () => {
    const result = calculateManufactureAction({
      actionHrid: '/actions/crafting/redwood_lumber',
      profile,
      data,
      prices: prices(),
    });

    expect(result.valid).toBe(true);
    expect(result.action).toBe('crafting');
    expect(result.outputHrid).toBe('/items/redwood_lumber');
    expect(result.actionsPerHour).toBeGreaterThan(0);
    expect(result.experiencePerHour).toBeGreaterThan(0);
    expect(result.inputs.some((item) => item.itemHrid === '/items/redwood_log')).toBe(true);
    expect(result.outputs.find((item) => item.itemHrid === '/items/redwood_lumber')?.market).toBe(true);
    expect(result.outputs.find((item) => item.itemHrid === '/items/crafting_essence')?.market).toBe(true);
    expect(result.outputs.find((item) => item.itemHrid === '/items/medium_artisans_crate')?.market).toBe(false);
    expect(result.incomePerHour).toBeCloseTo(result.outputs.reduce((sum, flow) => (
      sum + flow.unitsPerHour * flow.unitPrice! * 0.95
    ), 0));
    expect(result.profitPerHour).not.toBeNull();
  });

  it('fails closed when a required market side is absent', () => {
    const result = calculateManufactureAction({
      actionHrid: '/actions/crafting/redwood_lumber',
      profile,
      data,
      prices: prices(null),
    });

    expect(result.valid).toBe(false);
    expect(result.profitPerHour).toBeNull();
  });

  it('rejects non-manufacturing actions', () => {
    expect(() => calculateManufactureAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile,
      data,
      prices: prices(),
    })).toThrow('策略配方無法使用');
  });
});
