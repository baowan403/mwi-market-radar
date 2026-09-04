import { describe, expect, it } from 'vitest';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { calculateDecompose } from '../src/strategy/alchemy';
import type { PlayerProfile } from '../src/profile/types';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);

describe('Two-Layer Contract: Physical & Economic Ledger Parity Golden Tests', () => {
  const baselineProfile: PlayerProfile = {
    id: 'test:ledger-oracle',
    characterId: 9999,
    name: 'OracleTester',
    source: 'milkonomy-v1',
    importedAt: 0,
    completeness: 'full',
    missingFields: [],
    actions: {
      alchemy: {
        playerLevel: 100,
        tool: { itemHrid: '/items/holy_alembic', enhancementLevel: 10 },
        body: null,
        legs: null,
        back: null,
        charm: null,
        houseLevel: 4,
        teas: ['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea'],
      },
      brewing: {
        playerLevel: 100,
        tool: { itemHrid: '/items/holy_brewing_vat', enhancementLevel: 10 },
        body: null,
        legs: null,
        back: null,
        charm: null,
        houseLevel: 4,
        teas: ['/items/super_brewing_tea', '/items/gourmet_tea', '/items/artisan_tea'],
      },
      cooking: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      cheesesmithing: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      crafting: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      tailoring: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      woodcutting: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      foraging: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      milking: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      enhancing: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
    },
    specialEquipment: {
      hands: { itemHrid: '/items/enchanted_gloves', enhancementLevel: 10 },
      pouch: { itemHrid: '/items/guzzling_pouch', enhancementLevel: 10 },
    },
    communityBuffs: {
      experience: 10,
      production: 10,
      efficiency: 10,
    },
    shrines: {
      shrine_of_wisdom: 10,
      shrine_of_rhythm: 10,
    },
    achievements: {},
    inventoryMap: {
      '/items/holy_alembic': 10,
      '/items/enchanted_gloves': 10,
      '/items/guzzling_pouch': 10,
    },
    materialInventoryMap: {},
    seals: [],
  };

  const snapshot: Snapshot = {
    timestamp: 1700000000,
    quotes: {
      '/items/holy_milk::0': { a: 1530, b: 1450, p: 1490, v: 50000 },
      '/items/milking_essence::0': { a: 780, b: 760, p: 770, v: 200000 },
      '/items/prime_catalyst::0': { a: 15000, b: 14000, p: 14500, v: 2000 },
      '/items/ultra_alchemy_tea::0': { a: 3500, b: 3200, p: 3350, v: 5000 },
      '/items/catalytic_tea::0': { a: 2800, b: 2500, p: 2650, v: 5000 },
      '/items/efficiency_tea::0': { a: 1800, b: 1600, p: 1700, v: 5000 },
      '/items/alchemy_essence::0': { a: 2100, b: 2000, p: 2050, v: 10000 },
      '/items/large_artisans_crate::0': { a: 12000, b: 10000, p: 11000, v: 1000 },
      '/items/small_artisans_crate::0': { a: 1200, b: 1000, p: 1100, v: 1000 },
      '/items/medium_artisans_crate::0': { a: 5000, b: 4000, p: 4500, v: 1000 },
      '/items/bag_of_10_cowbells::0': { a: 1000, b: 1000, p: 1000, v: 1000 },
      '/items/shard_of_protection::0': { a: 10, b: 10, p: 10, v: 1000 },
      '/items/mirror_of_protection::0': { a: 15, b: 15, p: 15, v: 1000 },
      '/items/pearl::0': { a: 20, b: 20, p: 20, v: 1000 },
      '/items/amber::0': { a: 30, b: 30, p: 30, v: 1000 },
      '/items/garnet::0': { a: 40, b: 40, p: 40, v: 1000 },
      '/items/jade::0': { a: 50, b: 50, p: 50, v: 1000 },
      '/items/amethyst::0': { a: 60, b: 60, p: 60, v: 1000 },
      '/items/moonstone::0': { a: 70, b: 70, p: 70, v: 1000 },
    },
  };

  const prices = createStrategyPriceBook(snapshot, data);

  it('verifies Holy Milk Decompose Physical Ledger and Economic Ledger strictly', () => {
    const result = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 2,
      enhancementLevel: 0,
      profile: baselineProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    expect(result.ledger).toBeDefined();
    const ledger = result.ledger!;

    // ── 1. Physical Ledger 檢驗（不受市場價格影響） ──
    const physical = ledger.physical;
    expect(physical.effectiveLevel).toBeGreaterThanOrEqual(100);
    expect(physical.speed).toBeGreaterThan(1);
    expect(physical.efficiency).toBeGreaterThan(1);
    expect(physical.successRate).toBeGreaterThan(0.6);
    expect(physical.actionTimeSeconds).toBeGreaterThan(3.0);
    expect(physical.actionsPerHour).toBeGreaterThan(0);
    expect(physical.successfulActionsPerHour).toBeCloseTo(
      physical.actionsPerHour * physical.successRate,
      4,
    );

    // 產物物理數量檢驗
    expect(physical.inputUnitsPerHour['/items/holy_milk']).toBeCloseTo(
      physical.actionsPerHour * 2,
      3,
    );
    expect(physical.outputUnitsPerSuccess['/items/milking_essence']).toBe(20);
    expect(physical.outputUnitsPerHour['/items/milking_essence']).toBeCloseTo(
      physical.successfulActionsPerHour * 20,
      3,
    );

    // ── 2. Economic Ledger 檢驗（市場估值層） ──
    const economic = ledger.economic;
    expect(economic.inputAskPrices['/items/holy_milk']).toBe(1530);
    expect(economic.outputBidPrices['/items/milking_essence']).toBe(760);
    expect(economic.taxFactor).toBe(0.95);
    expect(economic.costPerHour).toBeGreaterThan(0);
    expect(economic.revenuePerHour).toBeGreaterThan(0);
    expect(economic.profitPerHour).toBeCloseTo(
      economic.revenuePerHour! - economic.costPerHour!,
      4,
    );
    expect(economic.profitPerDay).toBeCloseTo(economic.profitPerHour! * 24, 2);
  });

  it('separates physical mechanics from price fluctuations (Price-invariant Physical Ledger)', () => {
    const expensiveSnapshot: Snapshot = {
      timestamp: 1700000001,
      quotes: {
        ...snapshot.quotes,
        '/items/holy_milk::0': { a: 999999, b: 900000, p: 950000, v: 100 },
        '/items/milking_essence::0': { a: 10000, b: 9000, p: 9500, v: 100 },
      },
    };
    const expensivePrices = createStrategyPriceBook(expensiveSnapshot, data);

    const normalRun = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 2,
      enhancementLevel: 0,
      profile: baselineProfile,
      data,
      prices,
    });

    const expensiveRun = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 2,
      enhancementLevel: 0,
      profile: baselineProfile,
      data,
      prices: expensivePrices,
    });

    // 物理台帳必須 100% 絕對相等（完全不受市場價格擾動）
    expect(expensiveRun.ledger!.physical.speed).toBe(normalRun.ledger!.physical.speed);
    expect(expensiveRun.ledger!.physical.efficiency).toBe(normalRun.ledger!.physical.efficiency);
    expect(expensiveRun.ledger!.physical.actionsPerHour).toBe(normalRun.ledger!.physical.actionsPerHour);
    expect(expensiveRun.ledger!.physical.actionTimeSeconds).toBe(normalRun.ledger!.physical.actionTimeSeconds);
    expect(expensiveRun.ledger!.physical.outputUnitsPerHour).toEqual(normalRun.ledger!.physical.outputUnitsPerHour);

    // 經濟台帳則必須敏銳反映不同價格
    expect(expensiveRun.ledger!.economic.costPerHour).not.toBe(normalRun.ledger!.economic.costPerHour);
    expect(expensiveRun.ledger!.economic.revenuePerHour).not.toBe(normalRun.ledger!.economic.revenuePerHour);
  });
});
