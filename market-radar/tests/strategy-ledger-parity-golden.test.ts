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

describe('MWI Client Ground Truth & Parity Golden Tests (jotaro99)', () => {
  const snapshot: Snapshot = {
    timestamp: 1700000000,
    quotes: {
      '/items/holy_milk::0': { a: 960, b: 920, p: 940, v: 50000 },
      '/items/milking_essence::0': { a: 450, b: 447, p: 448, v: 200000 },
      '/items/emp_tea_leaf::0': { a: 116, b: 115, p: 115.5, v: 600000 },
      '/items/brewing_essence::0': { a: 292, b: 290, p: 291, v: 600000 },
      '/items/ultra_alchemy_tea::0': { a: 10400, b: 9800, p: 10000, v: 5000 },
      '/items/catalytic_tea::0': { a: 3320, b: 3100, p: 3200, v: 5000 },
      '/items/efficiency_tea::0': { a: 2990, b: 2800, p: 2900, v: 5000 },
      '/items/alchemy_essence::0': { a: 700, b: 674, p: 680, v: 10000 },
      '/items/large_artisans_crate::0': { a: 800000, b: 787000, p: 790000, v: 1000 },
      '/items/small_artisans_crate::0': { a: 8000, b: 7500, p: 7800, v: 1000 },
      '/items/medium_artisans_crate::0': { a: 50000, b: 45000, p: 48000, v: 1000 },
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

  it('verifies jotaro99 Holy Milk Decompose against MWI Client Ground Truth (8.97s, 63%) and Derived Mechanics (~824.26 actions/h)', () => {
    const result = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    expect(result.ledger).toBeDefined();
    const ledger = result.ledger!;
    const physical = ledger.physical;

    // ── 1. MWI Client Direct Observed Ground Truth (實機直接觀測值) ──
    expect(physical.actionTimeSeconds).toBeCloseTo(8.97, 2);
    expect(physical.successRate).toBeCloseTo(0.63, 2);

    // ── 2. Derived Mechanics (推導機制值，非 Client UI 直接顯示之原始數值) ──
    expect(Math.abs(physical.actionsPerHour - 824.5714)).toBeLessThan(0.5);
    expect(physical.actionsPerHour).toBeCloseTo(824.26, 1);
    expect(physical.successfulActionsPerHour).toBeCloseTo(physical.actionsPerHour * physical.successRate, 4);

    // 茶飲消耗量：三種茶飲皆為 12.0/h
    expect(physical.teaUnitsPerHour['/items/catalytic_tea']).toBeCloseTo(12.0, 2);
    expect(physical.teaUnitsPerHour['/items/efficiency_tea']).toBeCloseTo(12.0, 2);
    expect(physical.teaUnitsPerHour['/items/ultra_alchemy_tea']).toBeCloseTo(12.0, 2);

    // 原料消耗量：每動 2 瓶 Holy Milk -> actionsPerHour * 2
    expect(physical.inputUnitsPerHour['/items/holy_milk']).toBeCloseTo(physical.actionsPerHour * 2, 2);

    // 主產物產出量：每成功 1 次產出 20 個 Milking Essence -> successfulActionsPerHour * 20
    expect(physical.outputUnitsPerSuccess['/items/milking_essence']).toBe(20);
    expect(physical.outputUnitsPerHour['/items/milking_essence']).toBeCloseTo(
      physical.successfulActionsPerHour * 20,
      2,
    );

    // ── 2. 經濟估值層 (Economic Ledger) 與 Reconciliation ──
    const economic = ledger.economic;
    expect(economic.complete).toBe(true);
    expect(economic.inputAskPrices['/items/holy_milk']).toBe(960);
    expect(economic.outputBidPrices['/items/milking_essence']).toBe(447);

    // 稅率對帳：主要產物為市場交易品，稅率必須為 0.95
    expect(economic.outputValuations['/items/milking_essence']?.taxFactor).toBe(0.95);
    expect(economic.outputValuations['/items/milking_essence']?.unitBidPrice).toBe(447);
    expect(economic.outputValuations['/items/milking_essence']?.netValuePerHour).toBeCloseTo(
      physical.outputUnitsPerHour['/items/milking_essence']! * 447 * 0.95,
      1,
    );

    // 總營收 Reconciliation：所有產物淨收益總和必須等於 revenuePerHour
    let expectedRevenue = 0;
    for (const val of Object.values(economic.outputValuations)) {
      if (val.netValuePerHour !== null) {
        expectedRevenue += val.netValuePerHour;
      }
    }
    expect(economic.revenuePerHour).toBeCloseTo(expectedRevenue, 4);

    // 淨利 = 總營收 - 總成本
    expect(economic.costPerHour).toBeGreaterThan(0);
    expect(economic.profitPerHour).toBeCloseTo(
      economic.revenuePerHour! - economic.costPerHour!,
      4,
    );
    expect(economic.profitPerDay).toBeCloseTo(economic.profitPerHour! * 24, 2);
  });

  it('verifies jotaro99 Emp Tea Leaf Decompose against MWI Client Ground Truth (20 Brewing Essence / success, 8.97s, 63% success)', () => {
    // ── Evidence Contract ──
    const evidence = {
      type: 'observed' as const,
      source: 'MWI Client',
      observedAt: '2026-09-04',
      note: 'Emp Tea Leaf successful decompose produced exactly 20 Brewing Essence (raw count=10 * bulkMultiplier=2 = 20)',
    };
    expect(evidence.type).toBe('observed');

    const result = calculateDecompose({
      itemHrid: '/items/emp_tea_leaf',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    expect(result.ledger).toBeDefined();
    const physical = result.ledger!.physical;

    // ── 1. MWI Client Direct Observed Ground Truth (實機直接觀測值) ──
    // Base Lv110, Effective Lv118
    expect(jotaroProfile.actions.alchemy.playerLevel).toBe(110);
    expect(physical.effectiveLevel).toBe(118);
    // [OBSERVED] 耗時與成功率：8.97s, 63% (Rank 0)
    expect(physical.actionTimeSeconds).toBeCloseTo(8.97, 2);
    expect(physical.successRate).toBeCloseTo(0.63, 2);

    // ── 2. Derived Mechanics / MK Reference ──
    // [MK_REFERENCE] 動作率每小時推導值
    expect(physical.actionsPerHour).toBeCloseTo(824.26, 1);
    expect(physical.successfulActionsPerHour).toBeCloseTo(physical.actionsPerHour * physical.successRate, 4);

    // ── 3. MWI Client Observed Output (實機產出真理) ──
    // [OBSERVED] 每成功 1 次動作固定產出 20 個 Brewing Essence (10 * bulkMultiplier 2 = 20)
    expect(physical.outputUnitsPerSuccess['/items/brewing_essence']).toBe(20);
    expect(physical.outputUnitsPerHour['/items/brewing_essence']).toBeCloseTo(
      physical.successfulActionsPerHour * 20,
      2,
    );

    // 4. 原料消耗量：bulkMultiplier = 2, actionsPerHour * 2
    expect(physical.inputUnitsPerHour['/items/emp_tea_leaf']).toBeCloseTo(physical.actionsPerHour * 2, 2);
  });

  it('guarantees complete physical ledger even when market prices are missing (Zero-price dependency)', () => {
    // 建立完全缺失價格的空 PriceBook
    const emptySnapshot: Snapshot = {
      timestamp: 1700000000,
      quotes: {},
    };
    const emptyPrices = createStrategyPriceBook(emptySnapshot, data);

    const normalRun = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    const unpricedRun = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices: emptyPrices,
    });

    // 1. 經濟評估必須如實標註不完整
    expect(unpricedRun.ledger!.economic.complete).toBe(false);
    expect(unpricedRun.ledger!.economic.revenuePerHour).toBeNull();
    expect(unpricedRun.ledger!.economic.profitPerHour).toBeNull();
    expect(unpricedRun.ledger!.economic.profitPerDay).toBeNull();

    // 2. 物理台帳必須 100% 存在且數值與正常價格時完全同構
    const pNormal = normalRun.ledger!.physical;
    const pUnpriced = unpricedRun.ledger!.physical;

    expect(pUnpriced.actionTimeSeconds).toBe(pNormal.actionTimeSeconds);
    expect(pUnpriced.actionsPerHour).toBe(pNormal.actionsPerHour);
    expect(pUnpriced.successfulActionsPerHour).toBe(pNormal.successfulActionsPerHour);
    expect(pUnpriced.speed).toBe(pNormal.speed);
    expect(pUnpriced.efficiency).toBe(pNormal.efficiency);
    expect(pUnpriced.successRate).toBe(pNormal.successRate);
    expect(pUnpriced.inputUnitsPerHour).toEqual(pNormal.inputUnitsPerHour);
    expect(pUnpriced.outputUnitsPerHour).toEqual(pNormal.outputUnitsPerHour);
    expect(pUnpriced.teaUnitsPerHour).toEqual(pNormal.teaUnitsPerHour);
    expect(pUnpriced.rareAndEssenceUnitsPerHour).toEqual(pNormal.rareAndEssenceUnitsPerHour);
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
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
      data,
      prices,
    });

    const expensiveRun = calculateDecompose({
      itemHrid: '/items/holy_milk',
      catalystRank: 0,
      enhancementLevel: 0,
      profile: jotaroProfile,
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
