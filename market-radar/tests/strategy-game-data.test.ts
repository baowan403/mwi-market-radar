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

  it('preserves raw decompose count when VERIFIED_DECOMPOSE_OVERRIDES is empty (no override)', () => {
    // 1. VERIFIED_DECOMPOSE_OVERRIDES 已清空，raw count 應保持原始值 10
    //    經由 alchemy.ts 的 `out.count * bulkMultiplier` = 10 * 2 = 20 (正確 L1-OBSERVED 值)
    const normalized = normalizeStrategyGameData(strategyData);
    const empLeaf = normalized.itemsByHrid.get('/items/emp_tea_leaf');
    const decomp = (empLeaf?.alchemyDetail as any)?.decomposeItems;
    expect(decomp[0].itemHrid).toBe('/items/brewing_essence');
    expect(decomp[0].count).toBe(10); // raw count 未被 override，保持原始 GameData 值

    // 2. 驗證空 override dict 不干擾其他物品的正常 normalize
    const holyMilk = normalized.itemsByHrid.get('/items/holy_milk');
    const holyDecomp = (holyMilk?.alchemyDetail as any)?.decomposeItems;
    if (holyDecomp?.[0]) {
      expect(typeof holyDecomp[0].count).toBe('number');
    }

    // 3. 確認 override 機制框架仍存在（空 dict 不報錯）
    const clone = JSON.parse(JSON.stringify(strategyData));
    clone.itemDetailMap['/items/emp_tea_leaf'].alchemyDetail.decomposeItems[0].count = 30;
    // 空 override dict 不會觸發 Freshness Guard，任何 raw count 都被原樣保留
    const normalized30 = normalizeStrategyGameData(clone);
    const decomp30 = (normalized30.itemsByHrid.get('/items/emp_tea_leaf')?.alchemyDetail as any)?.decomposeItems;
    expect(decomp30[0].count).toBe(30); // 空 override = pass-through
  });
});
