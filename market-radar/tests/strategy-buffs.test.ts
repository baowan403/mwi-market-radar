import exporter from './fixtures/profile-export-v1.json';
import { describe, expect, it } from 'vitest';
import { importPlayerProfile } from '../src/profile/import';
import { actionBuffs } from '../src/strategy/buffs';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';

function fixtureProfile() {
  const profile = importPlayerProfile(JSON.stringify(exporter), 0);
  profile.actions.alchemy.tool = { itemHrid: '/items/test_alembic', enhancementLevel: 5 };
  profile.actions.alchemy.body = null;
  profile.actions.alchemy.legs = null;
  profile.actions.alchemy.back = null;
  profile.actions.alchemy.charm = null;
  profile.actions.alchemy.teas = ['/items/test_success_tea'];
  profile.specialEquipment = {
    pouch: { itemHrid: '/items/test_pouch', enhancementLevel: 0 },
  };
  profile.communityBuffs = { production_efficiency: 10 };
  profile.shrines = { rhythm: 1 };
  profile.achievements = {};
  return profile;
}

const itemDetails = new Map<string, unknown>([
  ['/items/test_pouch', {
    hrid: '/items/test_pouch',
    equipmentDetail: {
      noncombatStats: { drinkConcentration: 0.1 },
      noncombatEnhancementBonuses: {},
    },
  }],
  ['/items/test_alembic', {
    hrid: '/items/test_alembic',
    equipmentDetail: {
      noncombatStats: { alchemyEfficiency: 0.05 },
      noncombatEnhancementBonuses: { alchemyEfficiency: 0.01 },
    },
  }],
  ['/items/test_success_tea', {
    hrid: '/items/test_success_tea',
    consumableDetail: {
      buffs: [{ typeHrid: '/buff_types/alchemy_success', ratioBoost: 0.06, flatBoost: 0 }],
    },
  }],
]);

const gameDataFixture = {
  enhancementLevelTotalBonusMultiplierTable: [0, 1, 2, 3, 4, 5],
  itemsByHrid: itemDetails,
  actionsByHrid: new Map(),
  itemDetailMap: Object.fromEntries(itemDetails),
  actionDetailMap: {},
  communityBuffTypeDetailMap: {
    '/community_buff_types/production_efficiency': {
      usableInActionTypeMap: { '/action_types/alchemy': true },
      buff: { typeHrid: '/buff_types/efficiency', flatBoost: 0.14, flatBoostLevelBonus: 0 },
    },
  },
  achievementTierDetailMap: {},
  achievementDetailMap: {},
  personalBuffTypeDetailMap: {},
} as unknown as NormalizedStrategyGameData;

describe('Milkonomy-compatible skilling buffs', () => {
  it('combines only buffs applicable to the selected action', () => {
    const buffs = actionBuffs(fixtureProfile(), 'alchemy', gameDataFixture);

    expect(buffs.Level).toBeCloseTo(103);
    expect(buffs.Speed).toBeCloseTo(0.005);
    expect(buffs.Efficiency).toBeCloseTo(0.14 + 0.015 * 4 + 0.05 + 0.01 * 5);
    expect(buffs.Success).toBeCloseTo(0.06 * 1.1);
    expect(buffs.Artisan).toBe(0);
    expect(buffs.drinkConcentration).toBeCloseTo(0.1);
  });

  it('does not leak another action equipment or tea into alchemy', () => {
    const profile = fixtureProfile();
    profile.actions.crafting.tool = { itemHrid: '/items/test_crafting_tool', enhancementLevel: 10 };
    profile.actions.crafting.teas = ['/items/test_crafting_tea'];
    const buffs = actionBuffs(profile, 'alchemy', gameDataFixture);

    expect(buffs.Level).toBe(103);
    expect(buffs.Gourmet).toBe(0);
    expect(buffs.RareFind).toBeGreaterThanOrEqual(0);
  });
});
