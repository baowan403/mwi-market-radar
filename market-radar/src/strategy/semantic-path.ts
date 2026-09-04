import type { NormalizedStrategyGameData } from './game-data';
import type { StrategyCandidate } from './candidates';
import type { StrategyStepResult } from './types';
import type { SkillingAction } from '../profile/types';

const ACTION_VERBS: Record<SkillingAction, string> = {
  milking: '擠奶',
  foraging: '採摘',
  woodcutting: '伐木',
  cheesesmithing: '鍛造',
  crafting: '製作',
  tailoring: '縫紉',
  cooking: '烹飪',
  brewing: '沖泡',
  alchemy: '煉金',
  enhancing: '強化',
};

const COIN_HRID = '/items/coin';

export interface SemanticPathNode {
  type: 'buy' | 'gather' | 'craft' | 'decompose' | 'coinify' | 'sell';
  action?: string;
  itemHrid: string;
  label: string;
}

/**
 * 依候選人步驟與交易性質，生成清晰的語意化工序路徑。
 * 格式範例：
 * - 購買 楊桃 → 分解成 採摘精華 → 販賣
 * - 採摘 楊桃 → 烹飪 楊桃酸奶 → 販賣
 * - 購買 奶酪 → 鍛造 奶酪劍 → 分解成 奶酪 → 販賣
 * - 購買 海盜精煉碎片 → 分解成 海盜精華 → 點金（金幣）
 */
export function formatSemanticPath(
  candidate: StrategyCandidate,
  data: NormalizedStrategyGameData,
  itemName: (hrid: string) => string,
): string {
  const steps = candidate.steps;
  if (!steps || steps.length === 0) {
    return candidate.path.map(itemName).join(' → ');
  }

  const parts: string[] = [];
  const firstStep = steps[0]!;

  // 1. 起點：判斷是「採集」還是「市場購買」原料
  const isFirstGather = firstStep.action === 'milking'
    || firstStep.action === 'foraging'
    || firstStep.action === 'woodcutting';

  if (isFirstGather) {
    const verb = ACTION_VERBS[firstStep.action] ?? '採集';
    parts.push(`${verb} ${itemName(firstStep.outputHrid)}`);
  } else {
    // 製造/煉金第一步：尋找需要自外部市場購入的主要原料
    // 優先採用 candidate.path[0]（若不同於第一步產物），否則從 inputs 篩選非飲料與非貨幣材料
    const primaryInputHrid = candidate.path[0] && candidate.path[0] !== firstStep.outputHrid
      ? candidate.path[0]
      : firstStep.inputs.find((flow) => (
          flow.market
          && flow.itemHrid !== COIN_HRID
          && data.itemsByHrid.get(flow.itemHrid)?.categoryHrid !== '/item_categories/drink'
          && !flow.itemHrid.endsWith('_tea')
          && !flow.itemHrid.endsWith('_coffee')
        ))?.itemHrid;

    if (primaryInputHrid) {
      parts.push(`購買 ${itemName(primaryInputHrid)}`);
    }
  }

  // 2. 中間與後續工序步驟
  // 若第一步不是採集，且有明確動作（例如第一步是製作或分解），需要把第一步的工序加進來
  const startIndex = isFirstGather ? 1 : 0;

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i]!;
    const outputName = itemName(step.outputHrid);

    if (step.actionHrid.includes('/decompose')) {
      parts.push(`分解成 ${outputName}`);
    } else if (step.actionHrid.includes('/coinify')) {
      parts.push('點金（金幣）');
    } else {
      const verb = ACTION_VERBS[step.action] ?? '製作';
      parts.push(`${verb} ${outputName}`);
    }
  }

  // 3. 終點去向（產物處置）
  const lastStep = steps.at(-1)!;
  const lastOutputHrid = lastStep.outputHrid;

  if (lastStep.actionHrid.includes('/coinify') || lastOutputHrid === COIN_HRID) {
    // 點金步驟本身已經包含獲得金幣，無需再補販賣
    if (!parts.at(-1)?.includes('點金')) {
      parts.push('點金（金幣）');
    }
  } else {
    // 其他產物均於市場販賣（計 5% 交易所稅率與市場成交量）
    parts.push(`販賣 ${itemName(lastOutputHrid)}`);
  }

  // 去除連續重複的描述（例如已有 "分解成 奶酪" 又接 "販賣 奶酪" 時，簡潔整併或保留明確動作）
  return parts.join(' → ');
}
