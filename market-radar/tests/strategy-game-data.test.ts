import source from '../scripts/vendor/milkonomy/source.json';
import translations from '../scripts/vendor/milkonomy/zh-tw.json';
import strategyData from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import {
  isDerivedOpenableLootValue,
  normalizeStrategyGameData,
  StrategyDataError,
} from '../src/strategy/game-data';

describe('pinned strategy reference artifacts', () => {
  it('pins the reviewed Milkonomy source metadata', () => {
    expect(source).toMatchObject({
      repository: 'https://github.com/Polokikiki/Milkonomy.git',
      commit: '5941a7bd097819a201ef560e8c3d461c688e283d',
      license: 'MIT',
    });
    expect(source.gameVersion).toMatch(/^v\d+\./);
  });

  it('contains the calculator maps required by the browser', () => {
    expect(Object.keys(translations).length).toBeGreaterThan(500);
    expect(strategyData).toEqual(expect.objectContaining({
      gameVersion: expect.any(String),
      enhancementLevelTotalBonusMultiplierTable: expect.any(Array),
      itemDetailMap: expect.any(Object),
      actionDetailMap: expect.any(Object),
      communityBuffTypeDetailMap: expect.any(Object),
      achievementDetailMap: expect.any(Object),
      achievementTierDetailMap: expect.any(Object),
      personalBuffTypeDetailMap: expect.any(Object),
      openableLootDropMap: expect.any(Object),
      shopItemDetailMap: expect.any(Object),
    }));
  });

  it('normalizes committed data and rejects malformed calculator maps', () => {
    const normalized = normalizeStrategyGameData(strategyData);
    expect(normalized.itemsByHrid.size).toBeGreaterThan(100);
    expect(normalized.actionsByHrid.size).toBeGreaterThan(100);
    expect(() => normalizeStrategyGameData({ gameVersion: 'bad' })).toThrow(StrategyDataError);
  });

  it('preserves the raw Emp Tea Leaf decompose count instead of injecting an AI oracle', () => {
    const rawCount = strategyData.itemDetailMap['/items/emp_tea_leaf']?.alchemyDetail?.decomposeItems?.[0]?.count;
    expect(rawCount).toBe(10);

    const normalized = normalizeStrategyGameData(strategyData);
    const decomposeItems = normalized.itemsByHrid.get('/items/emp_tea_leaf')?.alchemyDetail?.decomposeItems;
    expect(decomposeItems?.[0]?.itemHrid).toBe('/items/brewing_essence');
    expect(decomposeItems?.[0]?.count).toBe(10);
  });

  it('distinguishes derived openable loot from market-backed items', () => {
    const normalized = normalizeStrategyGameData(strategyData);
    expect(isDerivedOpenableLootValue('/items/medium_artisans_crate', normalized)).toBe(true);
    expect(isDerivedOpenableLootValue('/items/large_artisans_crate', normalized)).toBe(true);
    expect(isDerivedOpenableLootValue('/items/bag_of_10_cowbells', normalized)).toBe(false);
    expect(isDerivedOpenableLootValue('/items/crafting_essence', normalized)).toBe(false);
  });
});
