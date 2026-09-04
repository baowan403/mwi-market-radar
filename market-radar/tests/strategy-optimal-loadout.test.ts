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
});
