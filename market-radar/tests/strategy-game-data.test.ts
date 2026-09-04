import source from '../scripts/vendor/milkonomy/source.json';
import translations from '../scripts/vendor/milkonomy/zh-tw.json';
import strategyData from '../scripts/vendor/milkonomy/strategy-data.json';
import { describe, expect, it } from 'vitest';
import {
  isDerivedOpenableLootValue,
  normalizeStrategyGameData,
  StrategyDataError,
} from '../src/strategy/game-data';

describe('pinned Milkonomy reference artifacts', () => {
  it('pins the reviewed MIT source and keeps deterministic metadata', () => {
    expect(source).toMatchObject({
      repository: 'https://github.com/Polokikiki/Milkonomy.git',
      commit: '5941a7bd097819a201ef560e8c3d461c688e283d',
      license: 'MIT',
    });
    expect(source.gameVersion).toMatch(/^v\d+\./);
    expect(source.files).toEqual(expect.objectContaining({
      gameDataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      translationsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      strategyDataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('contains translations and only the strategy maps needed by the browser', () => {
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
    expect(strategyData).not.toHaveProperty('monsterDetailMap');
    expect(strategyData).not.toHaveProperty('chat');
    expect(strategyData).not.toHaveProperty('character');
  });

  it('normalizes the committed data and rejects missing calculator maps', () => {
    const normalized = normalizeStrategyGameData(strategyData);

    expect(normalized.itemsByHrid.size).toBeGreaterThan(100);
    expect(normalized.actionsByHrid.size).toBeGreaterThan(100);
    expect(() => normalizeStrategyGameData({ gameVersion: 'bad' })).toThrow(StrategyDataError);
  });

  it('distinguishes derived openable loot from the market-backed cowbell bag exception', () => {
    const normalized = normalizeStrategyGameData(strategyData);

    expect(isDerivedOpenableLootValue('/items/medium_artisans_crate', normalized)).toBe(true);
    expect(isDerivedOpenableLootValue('/items/large_artisans_crate', normalized)).toBe(true);
    expect(isDerivedOpenableLootValue('/items/bag_of_10_cowbells', normalized)).toBe(false);
    expect(isDerivedOpenableLootValue('/items/crafting_essence', normalized)).toBe(false);
  });

  it('safely applies verified decompose override with Freshness Guard protection', () => {
    // 1. 驗證預設 strategyData 中的 Emp Tea Leaf 成功由 10 升級為 20
    const normalized = normalizeStrategyGameData(strategyData);
    const empLeaf = normalized.itemsByHrid.get('/items/emp_tea_leaf');
    const decomp = (empLeaf?.alchemyDetail as any)?.decomposeItems;
    expect(decomp[0].itemHrid).toBe('/items/brewing_essence');
    expect(decomp[0].count).toBe(20);

    // 2. 驗證若未來的 raw data 本身已是 20，no-op 正常通過
    const cloneNoop = JSON.parse(JSON.stringify(strategyData));
    cloneNoop.itemDetailMap['/items/emp_tea_leaf'].alchemyDetail.decomposeItems[0].count = 20;
    const normalizedNoop = normalizeStrategyGameData(cloneNoop);
    const decompNoop = (normalizedNoop.itemsByHrid.get('/items/emp_tea_leaf')?.alchemyDetail as any)?.decomposeItems;
    expect(decompNoop[0].count).toBe(20);

    // 3. 驗證若未來的 raw data 出現非預期數值（例如 30），觸發 Freshness Guard 拋出異常，防止未經驗收覆蓋
    const cloneConflict = JSON.parse(JSON.stringify(strategyData));
    cloneConflict.itemDetailMap['/items/emp_tea_leaf'].alchemyDetail.decomposeItems[0].count = 30;
    expect(() => normalizeStrategyGameData(cloneConflict)).toThrowError(/\[Freshness Guard\]/);
  });
});
