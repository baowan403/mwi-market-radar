export interface CountedItem {
  itemHrid: string;
  count: number;
}

export interface DropItem extends CountedItem {
  dropRate: number;
  maxCount: number;
}

export interface StrategyActionDetail {
  hrid: string;
  levelRequirement: { level: number };
  baseTimeCost: number;
  inputItems?: CountedItem[] | null;
  outputItems?: CountedItem[] | null;
  essenceDropTable?: DropItem[] | null;
  rareDropTable?: DropItem[] | null;
  upgradeItemHrid?: string | null;
  experienceGain?: { value: number } | null;
}

export interface StrategyItemDetail {
  hrid: string;
  name: string;
  itemLevel?: number;
  categoryHrid: string;
  equipmentDetail?: Record<string, unknown> | null;
  consumableDetail?: Record<string, unknown> | null;
  alchemyDetail?: Record<string, unknown> | null;
  scrollDetail?: Record<string, unknown> | null;
}

export interface StrategyGameDataInput {
  gameVersion: string;
  versionTimestamp: string;
  enhancementLevelTotalBonusMultiplierTable: number[];
  itemDetailMap: Record<string, StrategyItemDetail>;
  actionDetailMap: Record<string, StrategyActionDetail>;
  communityBuffTypeDetailMap: Record<string, unknown>;
  achievementDetailMap: Record<string, unknown>;
  achievementTierDetailMap: Record<string, unknown>;
  personalBuffTypeDetailMap: Record<string, unknown>;
}
