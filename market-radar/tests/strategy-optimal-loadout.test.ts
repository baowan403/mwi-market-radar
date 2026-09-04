import { describe, expect, it } from 'vitest';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import {
  bestSkillingEquipmentFromInventory,
  enrichProfileWithBestLoadout,
  optimalTeasForAction,
} from '../src/strategy/optimal-loadout';
import type { PlayerProfile } from '../src/profile/types';

describe('optimal loadout engine', () => {
  const data = normalizeStrategyGameData(strategyDataJson);

  it('returns optimal 3-tea combinations for skilling actions', () => {
    const alchemyTeas = optimalTeasForAction('alchemy');
    expect(alchemyTeas).toHaveLength(3);
    expect(alchemyTeas).toContain('/items/ultra_alchemy_tea');
    expect(alchemyTeas).toContain('/items/catalytic_tea');
    expect(alchemyTeas).toContain('/items/efficiency_tea');

    const foragingTeas = optimalTeasForAction('foraging');
    expect(foragingTeas).toHaveLength(3);
    expect(foragingTeas).toContain('/items/gathering_tea');

    const cookingTeas = optimalTeasForAction('cooking');
    expect(cookingTeas).toEqual(['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea']);

    const brewingTeas = optimalTeasForAction('brewing');
    expect(brewingTeas).toEqual(['/items/gourmet_tea', '/items/artisan_tea', '/items/efficiency_tea']);
  });

  it('strictly excludes combat-only equipment and selects true skilling equipment', () => {
    // 只有純戰鬥裝時，必須返回 null，絕不誤穿戰鬥裝
    const combatInventory = {
      '/items/flaming_robe_top': 10,
      '/items/flaming_robe_bottoms': 10,
      '/items/sorcerer_boots': 10,
    };
    const body = bestSkillingEquipmentFromInventory(combatInventory, 'alchemy', '/equipment_types/body', data);
    expect(body).toBeNull();

    // 擁有生活裝備時，精準穿上
    const skillingInventory = {
      '/items/flaming_robe_top': 10, // 戰鬥裝
      '/items/alchemists_top': 7,    // 煉金生活裝
    };
    const alchBody = bestSkillingEquipmentFromInventory(skillingInventory, 'alchemy', '/equipment_types/body', data);
    expect(alchBody).toEqual({
      itemHrid: '/items/alchemists_top',
      enhancementLevel: 7,
    });
  });

  it('enriches profile automatically when actionTeas and clothes are empty', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:yeyanzhu',
      characterId: 12345,
      name: 'yeyanzhu',
      source: 'milkonomy-v1',
      importedAt: Date.now(),
      completeness: 'full',
      missingFields: [],
      actions: {
        alchemy: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        milking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        foraging: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        woodcutting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cheesesmithing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        crafting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        tailoring: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cooking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        brewing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        enhancing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
      },
      specialEquipment: {},
      communityBuffs: {},
      shrines: {},
      achievements: {},
      inventoryMap: {
        '/items/foragers_top': 8,
        '/items/foragers_bottoms': 8,
        '/items/flaming_robe_top': 10,
      },
      materialInventoryMap: {},
      seals: [],
    };

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);

    // 驗證自動套用 3 種最優茶飲
    expect(enriched.actions.alchemy.teas).toEqual(['/items/ultra_alchemy_tea', '/items/catalytic_tea', '/items/efficiency_tea']);
    
    // 驗證 foraging 穿上背包裡的採集上下衣
    expect(enriched.actions.foraging.body).toEqual({ itemHrid: '/items/foragers_top', enhancementLevel: 8 });
    expect(enriched.actions.foraging.legs).toEqual({ itemHrid: '/items/foragers_bottoms', enhancementLevel: 8 });

    // 驗證 alchemy 沒有生活上衣，不會誤穿火袍
    expect(enriched.actions.alchemy.body).toBeNull();
  });

  it('automatically equips special skilling equipment (gloves, necklaces, off-hand) from inventory', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:special',
      characterId: 99999,
      name: 'special_tester',
      source: 'milkonomy-v1',
      importedAt: Date.now(),
      completeness: 'full',
      missingFields: [],
      actions: {
        alchemy: { playerLevel: 110, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 4, teas: [] },
        milking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        foraging: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        woodcutting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cheesesmithing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        crafting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        tailoring: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cooking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        brewing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        enhancing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
      },
      specialEquipment: {},
      communityBuffs: {},
      shrines: {},
      achievements: {},
      inventoryMap: {
        '/items/enchanted_gloves': 10,
        '/items/necklace_of_speed': 3,
        '/items/eye_watch': 0,
        '/items/guzzling_pouch': 5,
        '/items/flaming_robe_top': 10,
      },
      materialInventoryMap: {},
      seals: [],
    };

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);

    expect(enriched.specialEquipment.hands).toEqual({
      itemHrid: '/items/enchanted_gloves',
      enhancementLevel: 10,
    });
    expect(enriched.specialEquipment.neck).toEqual({
      itemHrid: '/items/necklace_of_speed',
      enhancementLevel: 3,
    });
    expect(enriched.specialEquipment.off_hand).toEqual({
      itemHrid: '/items/eye_watch',
      enhancementLevel: 0,
    });
    expect(enriched.specialEquipment.pouch).toEqual({
      itemHrid: '/items/guzzling_pouch',
      enhancementLevel: 5,
    });
  });

  it('equips skilling tools and specialized head/feet gear across all 10 life skills', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:all_10_skills',
      characterId: 77777,
      name: 'ten_skills_master',
      source: 'milkonomy-v1',
      importedAt: Date.now(),
      completeness: 'full',
      missingFields: [],
      actions: {
        milking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        foraging: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        woodcutting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cheesesmithing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        crafting: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        tailoring: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        cooking: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        brewing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        alchemy: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
        enhancing: { playerLevel: 80, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [] },
      },
      specialEquipment: {},
      communityBuffs: {},
      shrines: {},
      achievements: {},
      inventoryMap: {
        // 10 大技能工具
        '/items/holy_brush': 5,
        '/items/holy_shears': 7,
        '/items/rainbow_hatchet': 0,
        '/items/holy_hammer': 8,
        '/items/holy_chisel': 6,
        '/items/holy_needle': 5,
        '/items/rainbow_spatula': 2,
        '/items/rainbow_pot': 3,
        '/items/holy_alembic': 10,
        '/items/rainbow_enhancer': 4,
        // 特殊槽位
        '/items/red_culinary_hat': 0,
        '/items/collectors_boots': 0,
        '/items/enchanted_gloves': 10,
        '/items/eye_watch': 0,
        '/items/necklace_of_speed': 3,
        '/items/guzzling_pouch': 5,
      },
      materialInventoryMap: {},
      seals: [],
    };

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);

    // 驗證 10 大技能工具均自動穿上
    expect(enriched.actions.milking.tool).toEqual({ itemHrid: '/items/holy_brush', enhancementLevel: 5 });
    expect(enriched.actions.foraging.tool).toEqual({ itemHrid: '/items/holy_shears', enhancementLevel: 7 });
    expect(enriched.actions.woodcutting.tool).toEqual({ itemHrid: '/items/rainbow_hatchet', enhancementLevel: 0 });
    expect(enriched.actions.cheesesmithing.tool).toEqual({ itemHrid: '/items/holy_hammer', enhancementLevel: 8 });
    expect(enriched.actions.crafting.tool).toEqual({ itemHrid: '/items/holy_chisel', enhancementLevel: 6 });
    expect(enriched.actions.tailoring.tool).toEqual({ itemHrid: '/items/holy_needle', enhancementLevel: 5 });
    expect(enriched.actions.cooking.tool).toEqual({ itemHrid: '/items/rainbow_spatula', enhancementLevel: 2 });
    expect(enriched.actions.brewing.tool).toEqual({ itemHrid: '/items/rainbow_pot', enhancementLevel: 3 });
    expect(enriched.actions.alchemy.tool).toEqual({ itemHrid: '/items/holy_alembic', enhancementLevel: 10 });
    expect(enriched.actions.enhancing.tool).toEqual({ itemHrid: '/items/rainbow_enhancer', enhancementLevel: 4 });

    // 驗證特殊生活槽位均自動穿上
    expect(enriched.specialEquipment.head).toEqual({ itemHrid: '/items/red_culinary_hat', enhancementLevel: 0 });
    expect(enriched.specialEquipment.feet).toEqual({ itemHrid: '/items/collectors_boots', enhancementLevel: 0 });
    expect(enriched.specialEquipment.hands).toEqual({ itemHrid: '/items/enchanted_gloves', enhancementLevel: 10 });
    expect(enriched.specialEquipment.off_hand).toEqual({ itemHrid: '/items/eye_watch', enhancementLevel: 0 });
    expect(enriched.specialEquipment.neck).toEqual({ itemHrid: '/items/necklace_of_speed', enhancementLevel: 3 });
    expect(enriched.specialEquipment.pouch).toEqual({ itemHrid: '/items/guzzling_pouch', enhancementLevel: 5 });
  });

  it('selects higher profit uplift gear when competing in the same slot (Same-slot Uplift Test)', () => {
    // 同 slot (body) 比較：
    // 裝備 A: flaming_robe_top +10 (純戰鬥裝，無生活加成)
    // 裝備 B: alchemists_top +3 (煉金專屬生活加成)
    const inventory = {
      '/items/flaming_robe_top': 10,
      '/items/alchemists_top': 3,
    };
    const chosen = bestSkillingEquipmentFromInventory(inventory, 'alchemy', '/equipment_types/body', data);
    expect(chosen).not.toBeNull();
    // 必須選中 +3 的煉金上衣，而不是 +10 的火袍！
    expect(chosen!.itemHrid).toBe('/items/alchemists_top');
    expect(chosen!.enhancementLevel).toBe(3);
  });

  it('respects manual loadout lock and does not overwrite user locked equipment', () => {
    const rawProfile: PlayerProfile = {
      id: 'test:manual_lock',
      characterId: 8888,
      name: 'manual_lock_tester',
      source: 'milkonomy-v1',
      importedAt: Date.now(),
      completeness: 'full',
      missingFields: [],
      actions: {
        alchemy: {
          playerLevel: 80,
          tool: { itemHrid: '/items/alembic', enhancementLevel: 1 }, // 玩家手動鎖定的普通工具
          body: null, legs: null, back: null, charm: null, houseLevel: 2, teas: [],
          loadoutMode: 'manual', // 顯式手動鎖定
        },
        milking: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        foraging: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        woodcutting: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        cheesesmithing: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        crafting: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        tailoring: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        cooking: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        brewing: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
        enhancing: { playerLevel: 1, tool: null, body: null, legs: null, back: null, charm: null, houseLevel: 0, teas: [] },
      },
      specialEquipment: {},
      communityBuffs: {},
      shrines: {},
      achievements: {},
      inventoryMap: {
        '/items/holy_alembic': 10, // 背包裡有更強的 +10 神聖工具
      },
      materialInventoryMap: {},
      seals: [],
    };

    const enriched = enrichProfileWithBestLoadout(rawProfile, data);

    // 驗證手動模式下，系統絕不私自替換玩家鎖定的工具
    expect(enriched.actions.alchemy.tool).toEqual({
      itemHrid: '/items/alembic',
      enhancementLevel: 1,
    });
  });
});
