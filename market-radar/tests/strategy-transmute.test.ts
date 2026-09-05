import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../src/profile/types';
import type { ActionBuffs } from '../src/strategy/buffs';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';
import type { MarketPriceBook } from '../src/strategy/price-book';
import { calculateTransmute } from '../src/strategy/transmute';

const inputHrid = '/items/transmute_input';
const outputHrid = '/items/transmute_output';

const itemDetailMap = {
  [inputHrid]: {
    hrid: inputHrid,
    name: 'Transmute Input',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
    itemLevel: 10,
    sellPrice: 100,
    alchemyDetail: {
      bulkMultiplier: 2,
      transmuteSuccessRate: 0.5,
      transmuteDropTable: [
        { itemHrid: outputHrid, dropRate: 0.5, minCount: 2, maxCount: 2 },
        { itemHrid: inputHrid, dropRate: 0.25, minCount: 1, maxCount: 1 },
      ],
    },
  },
  [outputHrid]: {
    hrid: outputHrid,
    name: 'Transmute Output',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/small_artisans_crate': {
    hrid: '/items/small_artisans_crate',
    name: 'Small Crate',
    categoryHrid: '/item_categories/loot',
    isTradable: true,
  },
  '/items/alchemy_essence': {
    hrid: '/items/alchemy_essence',
    name: 'Alchemy Essence',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/catalyst_of_transmutation': {
    hrid: '/items/catalyst_of_transmutation',
    name: 'Transmutation Catalyst',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
  '/items/prime_catalyst': {
    hrid: '/items/prime_catalyst',
    name: 'Prime Catalyst',
    categoryHrid: '/item_categories/resource',
    isTradable: true,
  },
};

const actionDetailMap = {
  '/actions/alchemy/transmute': {
    hrid: '/actions/alchemy/transmute',
    levelRequirement: { level: 1 },
    baseTimeCost: 10_000_000_000,
  },
};

const data = {
  gameVersion: 'test',
  versionTimestamp: 'test',
  enhancementLevelTotalBonusMultiplierTable: [0],
  itemDetailMap,
  actionDetailMap,
  communityBuffTypeDetailMap: {},
  achievementDetailMap: {},
  achievementTierDetailMap: {},
  personalBuffTypeDetailMap: {},
  openableLootDropMap: {},
  shopItemDetailMap: {},
  itemsByHrid: new Map(Object.entries(itemDetailMap)),
  actionsByHrid: new Map(Object.entries(actionDetailMap)),
} as unknown as NormalizedStrategyGameData;

const profile = {
  id: 'test',
  name: 'test',
  actions: { alchemy: { playerLevel: 100, teas: [] } },
} as unknown as PlayerProfile;

const buffs: ActionBuffs = {
  Level: 100,
  Speed: 0,
  Efficiency: 0,
  Experience: 0,
  Gathering: 0,
  Processing: 0,
  Artisan: 0,
  Gourmet: 0,
  Success: 0,
  Blessed: 0,
  EssenceFind: 0,
  RareFind: 0,
  drinkConcentration: 0,
};

const asks: Record<string, number> = {
  [inputHrid]: 1_000,
  '/items/catalyst_of_transmutation': 200,
  '/items/prime_catalyst': 300,
};
const bids: Record<string, number> = {
  [outputHrid]: 5_000,
  '/items/small_artisans_crate': 100,
  '/items/alchemy_essence': 100,
};
const prices: MarketPriceBook = {
  timestamp: 1,
  ask: (hrid) => asks[hrid] ?? null,
  bid: (hrid) => bids[hrid] ?? null,
  average: () => null,
  volume: () => null,
};

describe('Milkonomy-compatible transmutation', () => {
  it('uses Ask/Bid, coin cost, success rate and same-item return accounting', () => {
    const result = calculateTransmute({
      itemHrid: inputHrid,
      catalystRank: 0,
      profile,
      data,
      prices,
      buffs,
    });

    expect(result.valid).toBe(true);
    expect(result.actionHrid).toBe('/actions/alchemy/transmute');
    expect(result.outputHrid).toBe(outputHrid);
    expect(result.successRate).toBeCloseTo(0.5);
    expect(result.actionsPerHour).toBeCloseTo(684);
    // sameItemCounter = 1 * 0.25 * 0.5 = 0.125;
    // Net purchased input keeps the self-return accounting while level efficiency scales actions/h.
    expect(result.inputs.find((flow) => flow.itemHrid === inputHrid)?.unitsPerHour).toBeCloseTo(
      result.actionsPerHour * 2 * (1 - 0.125),
    );
    // Coin cost = bulk 2 * max(floor(100 / 5), 50) for every attempted action.
    expect(result.inputs.find((flow) => flow.itemHrid === '/items/coin')?.unitsPerHour).toBeCloseTo(
      result.actionsPerHour * 100,
    );
    // Main output = expected 2 units per success, then scaled by successful actions/h.
    expect(result.outputs.find((flow) => flow.itemHrid === outputHrid)?.unitsPerHour).toBeCloseTo(
      result.actionsPerHour * result.successRate * 2,
    );
    expect(result.costPerHour).toBeCloseTo(
      result.actionsPerHour * 2 * (1 - 0.125) * 1_000 + result.actionsPerHour * 100,
    );
    expect(result.profitPerHour).not.toBeNull();
  });

  it('uses the transmutation catalyst only on successful actions', () => {
    const result = calculateTransmute({
      itemHrid: inputHrid,
      catalystRank: 1,
      profile,
      data,
      prices,
      buffs,
    });

    // Dedicated catalyst contributes +0.15 inside the base-rate multiplier.
    expect(result.successRate).toBeCloseTo(0.575);
    expect(result.inputs.find((flow) => (
      flow.itemHrid === '/items/catalyst_of_transmutation'
    ))?.unitsPerHour).toBeCloseTo(result.actionsPerHour * result.successRate);
    expect(result.outputs.find((flow) => flow.itemHrid === outputHrid)?.unitsPerHour).toBeCloseTo(
      result.actionsPerHour * result.successRate * 2,
    );
  });
});
