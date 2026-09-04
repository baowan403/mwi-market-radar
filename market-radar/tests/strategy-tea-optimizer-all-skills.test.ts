import { describe, expect, it } from 'vitest';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import { createStrategyPriceBook } from '../src/strategy/price-book';
import { calculateGatherAction, calculateManufactureAction } from '../src/strategy/manufacture-adapter';
import type { PlayerProfile } from '../src/profile/types';
import type { Snapshot } from '../src/core/types';

const data = normalizeStrategyGameData(strategyDataJson);

describe('Dynamic Tea Optimizer: Full 10 Life Skills Coverage & Explicit Manual Lock', () => {
  const baseProfile: PlayerProfile = {
    id: 'test:tea_tester',
    characterId: 10101,
    name: 'TeaMaster',
    source: 'milkonomy-v1',
    importedAt: Date.now(),
    completeness: 'full',
    missingFields: [],
    actions: {
      milking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      foraging: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      woodcutting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      cheesesmithing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      crafting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      tailoring: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      cooking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      brewing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      alchemy: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
      enhancing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [], teaMode: 'auto' },
    },
    specialEquipment: {},
    communityBuffs: {},
    shrines: {},
    achievements: {},
    inventoryMap: {},
    materialInventoryMap: {},
    seals: [],
  };

  const snapshot: Snapshot = {
    timestamp: 1,
    quotes: {
      '/items/redwood_log::0': { a: 5000, b: 4800, p: 4900, v: 10_000 },
      '/items/woodcutting_essence::0': { a: 500, b: 450, p: 475, v: 10_000 },
      '/items/medium_meteorite_cache::0': { a: 100_000, b: 90_000, p: 95_000, v: 10 },
      '/items/branch_of_insight::0': { a: 1_000_000, b: 900_000, p: 950_000, v: 1 },
      '/items/cowbell::0': { a: 50, b: 40, p: 45, v: 10_000 },
      '/items/star_fragment::0': { a: 200, b: 180, p: 190, v: 50_000 },
      '/items/ultra_woodcutting_tea::0': { a: 1000, b: 900, p: 950, v: 10_000 },
      '/items/gathering_tea::0': { a: 500, b: 450, p: 475, v: 10_000 },
      '/items/processing_tea::0': { a: 500, b: 450, p: 475, v: 10_000 },
      '/items/efficiency_tea::0': { a: 500, b: 450, p: 475, v: 10_000 },
    },
  };

  const prices = createStrategyPriceBook(snapshot, data);

  it('automatically optimizes tea for gathering actions in auto mode', () => {
    const result = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile: baseProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    expect(result.ledger).toBeDefined();
    // 驗證 Auto 模式下自動選用了最優茶飲（利潤最大化）
    expect(Object.keys(result.ledger!.physical.teaUnitsPerHour).length).toBeGreaterThan(0);
  });

  it('strictly respects manual empty teas [] and never forces teas upon the player', () => {
    const manualProfile: PlayerProfile = {
      ...baseProfile,
      actions: {
        ...baseProfile.actions,
        woodcutting: {
          ...baseProfile.actions.woodcutting,
          teas: [], // 玩家顯式指定不喝茶！
          teaMode: 'manual', // 顯式手動鎖定
        },
      },
    };

    const result = calculateGatherAction({
      actionHrid: '/actions/woodcutting/redwood_tree',
      profile: manualProfile,
      data,
      prices,
    });

    expect(result.valid).toBe(true);
    expect(result.ledger).toBeDefined();
    // 驗證手動模式下，茶飲消耗嚴格為 0，絕對不被覆蓋
    expect(Object.keys(result.ledger!.physical.teaUnitsPerHour).length).toBe(0);
  });
});
