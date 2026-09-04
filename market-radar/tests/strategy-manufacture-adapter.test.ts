import exporter from './fixtures/profile-export-v1.json';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { calculateManufactureAction, calculateGatherAction } from '../src/strategy/manufacture-adapter';
import { actionBuffs } from '../src/strategy/buffs';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { evaluateRealizableStrategy } from '../src/strategy/realizable';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { MarketKey, Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);
const profile = importPlayerProfile(JSON.stringify(exporter), 0);

function prices(outputBid: number | null = 300, missingMoonstone = false) {
  const snapshot: Snapshot = {
    timestamp: 1,
    quotes: {
      '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
      '/items/redwood_lumber::0': { a: 320, b: outputBid, p: 310, v: 5_000 },
      '/items/crafting_essence::0': { a: 1_100, b: 1_000, p: 1_050, v: 1_000 },
      '/items/branch_of_insight::0': { a: 1_100_000, b: 1_000_000, p: 1_050_000, v: 10 },
      '/items/bag_of_10_cowbells::0': { a: 1_000, b: 1_000, p: 1_000, v: 1_000 },
      '/items/shard_of_protection::0': { a: 10, b: 10, p: 10, v: 1_000 },
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

function history(step: ReturnType<typeof calculateManufactureAction>, omitHrid?: string): Snapshot[] {
  const marketHrids = [...step.inputs, ...step.outputs]
    .filter((flow) => flow.market && flow.itemHrid !== omitHrid)
    .map((flow) => flow.itemHrid);
  return Array.from({ length: 169 }, (_, index) => ({
    timestamp: index * 3_600_000,
    quotes: Object.fromEntries(marketHrids.map((hrid) => [
      `${hrid}::0` as MarketKey,
      { a: 100, b: 100, p: 100, v: 1_000_000 },
    ])),
  }));
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
    expect(result.outputs.some((item) => item.itemHrid === '/items/medium_artisans_crate')).toBe(false);
    expect(result.outputs.find((item) => item.itemHrid === '/items/coin')?.market).toBe(false);
    expect(result.outputs.find((item) => item.itemHrid === '/items/cowbell')?.market).toBe(false);
    expect(result.outputs.find((item) => item.itemHrid === '/items/moonstone')?.market).toBe(true);
    expect(result.incomePerHour).toBeCloseTo(result.outputs.reduce((sum, flow) => (
      sum + flow.unitsPerHour * flow.unitPrice! * (flow.market ? 0.95 : 1)
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

  it('fails closed when any contained loot leaf cannot be priced', () => {
    const result = calculateManufactureAction({
      actionHrid: '/actions/crafting/redwood_lumber',
      profile,
      data,
      prices: prices(300, true),
    });

    expect(result.valid).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.incomePerHour).toBeNull();
    expect(result.profitPerHour).toBeNull();
  });

  it('makes every contained market leaf participate in realizable liquidity', () => {
    const step = calculateManufactureAction({
      actionHrid: '/actions/crafting/redwood_lumber', profile, data, prices: prices(),
    });
    const candidate: StrategyCandidate = {
      id: step.id, kind: 'manufacture', title: 'Redwood Lumber',
      path: ['/items/redwood_log', '/items/redwood_lumber'],
      profitPerHour: step.profitPerHour!, profitPerDay: step.profitPerHour! * 24,
      costPerHour: step.costPerHour!, incomePerHour: step.incomePerHour!,
      workingCapital24h: step.costPerHour! * 24, steps: [step],
    };

    const liquid = evaluateRealizableStrategy(candidate, history(step));
    const missingGem = evaluateRealizableStrategy(candidate, history(step, '/items/moonstone'));

    expect(liquid.classification).toBe('long-run');
    expect(liquid.theoreticalProfitPerDay).toBe(candidate.profitPerDay);
    expect(missingGem.classification).toBe('insufficient');
    expect(missingGem.bottleneckHrid).toBe('/items/moonstone');
  });

  it('keeps a nontradable coin recipe input outside market liquidity', () => {
    const actionHrid = '/actions/crafting/redwood_lumber';
    const detail = data.actionsByHrid.get(actionHrid)!;
    const coinInputData = {
      ...data,
      actionsByHrid: new Map(data.actionsByHrid).set(actionHrid, {
        ...detail,
        inputItems: [{ itemHrid: '/items/coin', count: 1 }],
      }),
    };
    const result = calculateManufactureAction({
      actionHrid, profile, data: coinInputData, prices: prices(),
    });

    expect(result.valid).toBe(true);
    expect(result.inputs).toEqual([expect.objectContaining({
      itemHrid: '/items/coin', unitPrice: 1, market: false,
    })]);
  });

  it('rejects non-manufacturing actions', () => {
    expect(() => calculateManufactureAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile,
      data,
      prices: prices(),
    })).toThrow('策略配方無法使用');
  });

  it('calculates a real gathering action for woodcutting redwood tree', () => {
    const customSnapshot: Snapshot = {
      timestamp: 1,
      quotes: {
        '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
        '/items/woodcutting_essence::0': { a: 500, b: 450, p: 475, v: 10_000 },
        '/items/medium_meteorite_cache::0': { a: 100_000, b: 90_000, p: 95_000, v: 10 },
        '/items/branch_of_insight::0': { a: 1_000_000, b: 900_000, p: 950_000, v: 1 },
        '/items/cowbell::0': { a: 50, b: 40, p: 45, v: 10_000 },
        '/items/star_fragment::0': { a: 200, b: 180, p: 190, v: 50_000 },
      },
    };
    const book = createStrategyPriceBook(customSnapshot, data);
    const result = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile,
      data,
      prices: book,
    });

    expect(result.valid).toBe(true);
    expect(result.action).toBe('woodcutting');
    expect(result.outputHrid).toBe('/items/redwood_log');
    expect(result.profitPerHour).toBeGreaterThan(0);
    expect(result.inputs).toEqual([]); // 沒喝茶則 inputs 為空
    expect(result.outputs.some((flow) => flow.itemHrid === '/items/redwood_log')).toBe(true);
  });

  it('keeps gathering tea in both cost and external-input liquidity flows', () => {
    const teaProfile = structuredClone(profile);
    teaProfile.actions.woodcutting.teas = ['/items/super_speed_tea'];
    teaProfile.actions.woodcutting.teaMode = 'manual';
    const customSnapshot: Snapshot = {
      timestamp: 1,
      quotes: {
        '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
        '/items/woodcutting_essence::0': { a: 500, b: 450, p: 475, v: 10_000 },
        '/items/medium_meteorite_cache::0': { a: 100_000, b: 90_000, p: 95_000, v: 10 },
        '/items/branch_of_insight::0': { a: 1_000_000, b: 900_000, p: 950_000, v: 1 },
        '/items/cowbell::0': { a: 50, b: 40, p: 45, v: 10_000 },
        '/items/star_fragment::0': { a: 200, b: 180, p: 190, v: 50_000 },
        '/items/super_speed_tea::0': { a: 1_000, b: 900, p: 950, v: 10_000 },
      },
    };
    const result = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile: teaProfile,
      data,
      prices: createStrategyPriceBook(customSnapshot, data),
    });

    const tea = result.inputs.find((flow) => flow.itemHrid === '/items/super_speed_tea');
    expect(tea?.unitsPerHour).toBeGreaterThan(0);
    expect(tea?.unitPrice).toBe(1_000);
    expect(result.costPerHour).toBeGreaterThan(0);
  });

  it('scales gathering output quantity by buffs.Gathering', () => {
    const customSnapshot: Snapshot = {
      timestamp: 1,
      quotes: {
        '/items/redwood_log::0': { a: 100, b: 90, p: 95, v: 10_000 },
        '/items/woodcutting_essence::0': { a: 500, b: 450, p: 475, v: 10_000 },
      },
    };
    const book = createStrategyPriceBook(customSnapshot, data);
    const baseBuffs = actionBuffs(profile, 'woodcutting', data);
    const normal = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree', profile, data, prices: book, buffs: { ...baseBuffs, Gathering: 0 },
    });
    const boosted = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree', profile, data, prices: book, buffs: { ...baseBuffs, Gathering: 0.5 },
    });
    const normalUnits = normal.outputs.find((f) => f.itemHrid === '/items/redwood_log')?.unitsPerHour ?? 0;
    const boostedUnits = boosted.outputs.find((f) => f.itemHrid === '/items/redwood_log')?.unitsPerHour ?? 0;
    expect(boostedUnits).toBeCloseTo(normalUnits * 1.5, 4);
  });
});
