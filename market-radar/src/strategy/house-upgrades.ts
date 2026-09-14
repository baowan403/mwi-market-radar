import type { PlayerProfile, SkillingAction } from '../profile/types';
import type { MarketPriceBook } from './price-book';
import type { StrategyHouseRoomDetail } from './types';

export interface HouseUpgradeMaterial {
  itemHrid: string;
  count: number;
  unitPrice: number | null;
}

export interface HouseUpgradeTarget {
  houseHrid: string;
  name: string;
  currentLevel: number;
  targetLevel: number;
  price: number | null;
  materials: HouseUpgradeMaterial[];
}

export function buildHouseUpgradeTargets(options: {
  profile: PlayerProfile;
  action: SkillingAction;
  rooms: Readonly<Record<string, StrategyHouseRoomDetail>>;
  prices: MarketPriceBook;
}): HouseUpgradeTarget[] {
  const room = Object.values(options.rooms).find(value => value.skillHrid === `/skills/${options.action}`);
  if (!room) return [];
  const currentLevel = Math.max(0, Math.floor(options.profile.actions[options.action]?.houseLevel ?? 0));
  const levels = Object.keys(room.upgradeCostsMap).map(Number)
    .filter(level => Number.isInteger(level) && level > currentLevel).sort((a, b) => a - b);
  const accumulated = new Map<string, number>();
  const result: HouseUpgradeTarget[] = [];
  for (const targetLevel of levels) {
    for (const item of room.upgradeCostsMap[String(targetLevel)] ?? []) {
      accumulated.set(item.itemHrid, (accumulated.get(item.itemHrid) ?? 0) + item.count);
    }
    const materials = [...accumulated.entries()].map(([itemHrid, count]) => ({
      itemHrid, count, unitPrice: itemHrid === '/items/coin' ? 1 : options.prices.ask(itemHrid),
    }));
    const complete = materials.every(item => item.unitPrice !== null && item.unitPrice >= 0);
    result.push({
      houseHrid: room.hrid, name: room.name, currentLevel, targetLevel,
      price: complete ? materials.reduce((sum, item) => sum + item.count * item.unitPrice!, 0) : null,
      materials,
    });
  }
  return result;
}
