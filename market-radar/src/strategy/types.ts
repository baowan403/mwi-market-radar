export interface CountedItem {
  itemHrid: string;
  count: number;
}

export interface DropItem {
  itemHrid: string;
  dropRate: number;
  minCount: number;
  maxCount: number;
}

export interface StrategyFlow {
  itemHrid: string;
  enhancementLevel: number;
  unitsPerHour: number;
  unitPrice: number | null;
  market: boolean;
}

export interface PhysicalLedger {
  effectiveLevel: number;
  speed: number;
  efficiency: number;
  successRate: number;
  actionTimeSeconds: number;
  actionsPerHour: number;
  successfulActionsPerHour: number;
  inputUnitsPerHour: Record<string, number>;
  outputUnitsPerSuccess: Record<string, number>;
  outputUnitsPerHour: Record<string, number>;
  rareAndEssenceUnitsPerHour: Record<string, number>;
  teaUnitsPerHour: Record<string, number>;
}

export interface EconomicLedger {
  inputAskPrices: Record<string, number | null>;
  outputBidPrices: Record<string, number | null>;
  taxFactor: number;
  teaAskPrices: Record<string, number | null>;
  revenuePerHour: number | null;
  costPerHour: number | null;
  profitPerHour: number | null;
  profitPerDay: number | null;
}

export interface StrategyLedger {
  physical: PhysicalLedger;
  economic: EconomicLedger;
}

export interface StrategyStepResult {
  id: string;
  action: import('../profile/types').SkillingAction;
  actionHrid: string;
  outputHrid: string;
  valid: boolean;
  actionsPerHour: number;
  costPerHour: number | null;
  incomePerHour: number | null;
  profitPerHour: number | null;
  experiencePerHour: number;
  inputs: StrategyFlow[];
  outputs: StrategyFlow[];
  ledger?: StrategyLedger;
}

export interface StrategyActionDetail {
  hrid: string;
  levelRequirement: { level: number };
  baseTimeCost: number;
  inputItems?: CountedItem[] | null;
  outputItems?: CountedItem[] | null;
  dropTable?: DropItem[] | null;
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
  isTradable?: boolean;
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
  openableLootDropMap: Record<string, Array<{
    itemHrid: string;
    dropRate: number;
    minCount: number;
    maxCount: number;
  }>>;
  shopItemDetailMap: Record<string, unknown>;
}
