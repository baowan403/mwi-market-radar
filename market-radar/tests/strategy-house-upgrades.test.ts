import { describe, expect, it } from 'vitest';
import { buildHouseUpgradeTargets } from '../src/strategy/house-upgrades';
import type { MarketPriceBook } from '../src/strategy/price-book';
import type { PlayerProfile } from '../src/profile/types';

const profile = {
  actions: { alchemy: { houseLevel: 4 } },
} as unknown as PlayerProfile;

const rooms = {
  '/house_rooms/laboratory': {
    hrid: '/house_rooms/laboratory', name: 'Laboratory', skillHrid: '/skills/alchemy',
    upgradeCostsMap: {
      5: [{ itemHrid: '/items/coin', count: 25_000_000 }, { itemHrid: '/items/a', count: 2 }],
      6: [{ itemHrid: '/items/coin', count: 50_000_000 }, { itemHrid: '/items/b', count: 3 }],
    },
  },
};

function prices(values: Record<string, number | null>): MarketPriceBook {
  return { timestamp: 1, ask: (hrid) => hrid === '/items/coin' ? 1 : values[hrid] ?? null,
    bid: () => null, average: () => null, volume: () => null };
}

describe('house upgrade targets', () => {
  it('uses full replacement cost and accumulates every intermediate level', () => {
    const result = buildHouseUpgradeTargets({ profile, action: 'alchemy', rooms, prices: prices({ '/items/a': 10, '/items/b': 20 }) });
    expect(result).toEqual([
      expect.objectContaining({ houseHrid: '/house_rooms/laboratory', currentLevel: 4, targetLevel: 5, price: 25_000_020 }),
      expect.objectContaining({ houseHrid: '/house_rooms/laboratory', currentLevel: 4, targetLevel: 6, price: 75_000_080 }),
    ]);
    expect(result[1]!.materials).toEqual([
      { itemHrid: '/items/coin', count: 75_000_000, unitPrice: 1 },
      { itemHrid: '/items/a', count: 2, unitPrice: 10 },
      { itemHrid: '/items/b', count: 3, unitPrice: 20 },
    ]);
  });

  it('keeps a target but marks its price unknown when any material lacks an ask', () => {
    const result = buildHouseUpgradeTargets({ profile, action: 'alchemy', rooms, prices: prices({ '/items/a': 10 }) });
    expect(result[0]!.price).toBe(25_000_020);
    expect(result[1]!.price).toBeNull();
  });
});
