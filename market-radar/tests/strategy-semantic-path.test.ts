import { describe, expect, it } from 'vitest';
import { formatSemanticPath } from '../src/strategy/semantic-path';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { NormalizedStrategyGameData } from '../src/strategy/game-data';

const mockData = {} as NormalizedStrategyGameData;
const mockNames: Record<string, string> = {
  '/items/starfruit': '楊桃',
  '/items/foraging_essence': '採摘精華',
  '/items/starfruit_yogurt': '楊桃酸奶',
  '/items/cheese': '奶酪',
  '/items/cheese_sword': '奶酪劍',
  '/items/pirate_refinement_shard': '海盜精煉碎片',
  '/items/pirate_essence': '海盜精華',
  '/items/coin': '金幣',
  '/items/redwood_log': '紅杉原木',
  '/items/redwood_lumber': '紅杉木板',
};
const itemName = (hrid: string) => mockNames[hrid] ?? hrid;

describe('formatSemanticPath', () => {
  it('formats single-step decompose: 購買 楊桃 → 分解成 採摘精華 → 販賣 採摘精華', () => {
    const candidate: StrategyCandidate = {
      id: 'decompose:starfruit',
      kind: 'decompose',
      title: '採摘精華',
      path: ['/items/starfruit', '/items/foraging_essence'],
      profitPerHour: 1000,
      profitPerDay: 24000,
      costPerHour: 500,
      incomePerHour: 1500,
      workingCapital24h: 12000,
      steps: [
        {
          id: 'step1',
          action: 'alchemy',
          actionHrid: '/actions/alchemy/decompose',
          outputHrid: '/items/foraging_essence',
          valid: true,
          actionsPerHour: 10,
          costPerHour: 500,
          incomePerHour: 1500,
          profitPerHour: 1000,
          experiencePerHour: 10,
          inputs: [{ itemHrid: '/items/starfruit', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 50, market: true }],
          outputs: [{ itemHrid: '/items/foraging_essence', enhancementLevel: 0, unitsPerHour: 20, unitPrice: 75, market: true }],
        },
      ],
      verificationStatus: 'unverified',
    };

    expect(formatSemanticPath(candidate, mockData, itemName)).toBe(
      '購買 楊桃 → 分解成 採摘精華 → 販賣 採摘精華',
    );
  });

  it('formats gather + craft: 採摘 楊桃 → 烹飪 楊桃酸奶 → 販賣 楊桃酸奶', () => {
    const candidate: StrategyCandidate = {
      id: 'workflow:starfruit_yogurt',
      kind: 'workflow',
      title: '楊桃酸奶',
      path: ['/items/starfruit', '/items/starfruit_yogurt'],
      profitPerHour: 2000,
      profitPerDay: 48000,
      costPerHour: 0,
      incomePerHour: 2000,
      workingCapital24h: 0,
      steps: [
        {
          id: 'step1',
          action: 'foraging',
          actionHrid: '/actions/foraging/starfruit',
          outputHrid: '/items/starfruit',
          valid: true,
          actionsPerHour: 10,
          costPerHour: 0,
          incomePerHour: 0,
          profitPerHour: 0,
          experiencePerHour: 10,
          inputs: [],
          outputs: [{ itemHrid: '/items/starfruit', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 50, market: false }],
        },
        {
          id: 'step2',
          action: 'cooking',
          actionHrid: '/actions/cooking/starfruit_yogurt',
          outputHrid: '/items/starfruit_yogurt',
          valid: true,
          actionsPerHour: 10,
          costPerHour: 0,
          incomePerHour: 2000,
          profitPerHour: 2000,
          experiencePerHour: 20,
          inputs: [{ itemHrid: '/items/starfruit', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 50, market: false }],
          outputs: [{ itemHrid: '/items/starfruit_yogurt', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 200, market: true }],
        },
      ],
      verificationStatus: 'unverified',
    };

    expect(formatSemanticPath(candidate, mockData, itemName)).toBe(
      '採摘 楊桃 → 烹飪 楊桃酸奶 → 販賣 楊桃酸奶',
    );
  });

  it('formats decompose + coinify: 購買 海盜精煉碎片 → 分解成 海盜精華 → 點金（金幣）', () => {
    const candidate: StrategyCandidate = {
      id: 'workflow:pirate_coinify',
      kind: 'decompose-coinify',
      title: '金幣',
      path: ['/items/pirate_refinement_shard', '/items/pirate_essence', '/items/coin'],
      profitPerHour: 3000,
      profitPerDay: 72000,
      costPerHour: 1000,
      incomePerHour: 4000,
      workingCapital24h: 24000,
      steps: [
        {
          id: 'step1',
          action: 'alchemy',
          actionHrid: '/actions/alchemy/decompose',
          outputHrid: '/items/pirate_essence',
          valid: true,
          actionsPerHour: 10,
          costPerHour: 1000,
          incomePerHour: 0,
          profitPerHour: -1000,
          experiencePerHour: 10,
          inputs: [{ itemHrid: '/items/pirate_refinement_shard', enhancementLevel: 0, unitsPerHour: 10, unitPrice: 100, market: true }],
          outputs: [{ itemHrid: '/items/pirate_essence', enhancementLevel: 0, unitsPerHour: 20, unitPrice: null, market: false }],
        },
        {
          id: 'step2',
          action: 'alchemy',
          actionHrid: '/actions/alchemy/coinify',
          outputHrid: '/items/coin',
          valid: true,
          actionsPerHour: 10,
          costPerHour: 0,
          incomePerHour: 4000,
          profitPerHour: 4000,
          experiencePerHour: 10,
          inputs: [{ itemHrid: '/items/pirate_essence', enhancementLevel: 0, unitsPerHour: 20, unitPrice: null, market: false }],
          outputs: [{ itemHrid: '/items/coin', enhancementLevel: 0, unitsPerHour: 4000, unitPrice: 1, market: false }],
        },
      ],
      verificationStatus: 'unverified',
    };

    expect(formatSemanticPath(candidate, mockData, itemName)).toBe(
      '購買 海盜精煉碎片 → 分解成 海盜精華 → 點金（金幣）',
    );
  });
});
