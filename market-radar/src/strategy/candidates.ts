import type { PlayerProfile, SkillingAction } from '../profile/types';
import { calculateCoinify, calculateDecompose, type CatalystRank } from './alchemy';
import { actionBuffs, type ActionBuffs } from './buffs';
import type { NormalizedStrategyGameData } from './game-data';
import { calculateManufactureAction } from './manufacture-adapter';
import type { MarketPriceBook } from './price-book';
import type { StrategyStepResult } from './types';
import { calculateWorkflow, type WorkflowResult } from './workflow';

const MANUFACTURING_ACTIONS = new Set<SkillingAction>([
  'cheesesmithing', 'crafting', 'tailoring', 'cooking', 'brewing',
]);
const CATALYST_RANKS: CatalystRank[] = [0, 1, 2];

export interface StrategyCandidate {
  id: string;
  kind: 'manufacture' | 'workflow' | 'decompose' | 'coinify' | 'decompose-coinify';
  title: string;
  path: string[];
  profitPerHour: number;
  profitPerDay: number;
  costPerHour: number;
  incomePerHour: number;
  workingCapital24h: number;
  steps: StrategyStepResult[];
}

export interface StrategyCandidateResult {
  candidates: StrategyCandidate[];
  diagnostics: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function manufacturingAction(hrid: string): SkillingAction | null {
  const action = hrid.split('/')[2] as SkillingAction | undefined;
  return action && MANUFACTURING_ACTIONS.has(action) ? action : null;
}

function titleFor(hrid: string, data: NormalizedStrategyGameData): string {
  return data.itemsByHrid.get(hrid)?.name ?? hrid;
}

function stepPath(step: StrategyStepResult): string[] {
  const input = step.inputs.find((flow) => flow.market && !flow.itemHrid.endsWith('_tea'))?.itemHrid;
  return [...(input ? [input] : []), step.outputHrid];
}

function candidateFromStep(
  step: StrategyStepResult,
  kind: StrategyCandidate['kind'],
  data: NormalizedStrategyGameData,
): StrategyCandidate | null {
  if (!step.valid || step.profitPerHour === null || step.costPerHour === null || step.incomePerHour === null) return null;
  return {
    id: step.id,
    kind,
    title: titleFor(step.outputHrid, data),
    path: stepPath(step),
    profitPerHour: step.profitPerHour,
    profitPerDay: step.profitPerHour * 24,
    costPerHour: step.costPerHour,
    incomePerHour: step.incomePerHour,
    workingCapital24h: step.costPerHour * 24,
    steps: [step],
  };
}

function candidateFromWorkflow(
  workflow: WorkflowResult,
  kind: 'workflow' | 'decompose-coinify',
  data: NormalizedStrategyGameData,
): StrategyCandidate | null {
  if (!workflow.valid || workflow.profitPerHour === null || workflow.costPerHour === null || workflow.incomePerHour === null) return null;
  const last = workflow.steps.at(-1)!;
  const firstInput = workflow.inputs.find((flow) => flow.market)?.itemHrid;
  return {
    id: workflow.id,
    kind,
    title: titleFor(last.outputHrid, data),
    path: [...(firstInput ? [firstInput] : []), ...workflow.steps.map((step) => step.outputHrid)],
    profitPerHour: workflow.profitPerHour,
    profitPerDay: workflow.profitPerHour * 24,
    costPerHour: workflow.costPerHour,
    incomePerHour: workflow.incomePerHour,
    workingCapital24h: workflow.costPerHour * 24,
    steps: workflow.steps,
  };
}

function consumersByInput(data: NormalizedStrategyGameData): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (inputHrid: string, actionHrid: string) => {
    const actions = result.get(inputHrid) ?? [];
    actions.push(actionHrid);
    result.set(inputHrid, actions);
  };
  for (const [actionHrid, detail] of data.actionsByHrid) {
    if (!manufacturingAction(actionHrid)) continue;
    if (typeof detail.upgradeItemHrid === 'string') add(detail.upgradeItemHrid, actionHrid);
    for (const input of detail.inputItems ?? []) add(input.itemHrid, actionHrid);
  }
  return result;
}

export function buildStrategyCandidates(options: {
  profile: PlayerProfile;
  data: NormalizedStrategyGameData;
  prices: MarketPriceBook;
}): StrategyCandidateResult {
  const { profile, data, prices } = options;
  const candidateMap = new Map<string, StrategyCandidate>();
  const diagnostics: string[] = [];
  const buffCache = new Map<SkillingAction, ActionBuffs>();
  const buffsFor = (action: SkillingAction): ActionBuffs => {
    const cached = buffCache.get(action);
    if (cached) return cached;
    const calculated = actionBuffs(profile, action, data);
    buffCache.set(action, calculated);
    return calculated;
  };
  const stepCache = new Map<string, StrategyStepResult | null>();
  const manufactureStep = (actionHrid: string): StrategyStepResult | null => {
    if (stepCache.has(actionHrid)) return stepCache.get(actionHrid) ?? null;
    const action = manufacturingAction(actionHrid);
    if (!action) return null;
    try {
      const step = calculateManufactureAction({
        actionHrid, profile, data, prices, buffs: buffsFor(action),
      });
      stepCache.set(actionHrid, step);
      return step;
    } catch {
      stepCache.set(actionHrid, null);
      diagnostics.push(actionHrid);
      return null;
    }
  };
  const addCandidate = (candidate: StrategyCandidate | null): void => {
    if (!candidate) return;
    const current = candidateMap.get(candidate.id);
    if (!current || candidate.profitPerHour > current.profitPerHour) candidateMap.set(candidate.id, candidate);
  };

  const actionHrids = [...data.actionsByHrid.keys()].filter((hrid) => manufacturingAction(hrid));
  for (const actionHrid of actionHrids) {
    const step = manufactureStep(actionHrid);
    if (step) addCandidate(candidateFromStep(step, 'manufacture', data));
  }

  const consumers = consumersByInput(data);
  const walk = (path: StrategyStepResult[], seenOutputs: Set<string>): void => {
    if (path.length >= 2) {
      try { addCandidate(candidateFromWorkflow(calculateWorkflow(path), 'workflow', data)); } catch { /* diagnostic only */ }
    }
    if (path.length >= 7) return;
    const outputHrid = path.at(-1)!.outputHrid;
    for (const consumerHrid of consumers.get(outputHrid) ?? []) {
      const next = manufactureStep(consumerHrid);
      if (!next || seenOutputs.has(next.outputHrid)) continue;
      walk([...path, next], new Set([...seenOutputs, next.outputHrid]));
    }
  };
  for (const step of stepCache.values()) {
    if (step) walk([step], new Set([step.outputHrid]));
  }

  const alchemyBuffs = buffsFor('alchemy');
  for (const [itemHrid, rawItem] of data.itemsByHrid) {
    const detail = record(record(rawItem)?.alchemyDetail);
    if (!detail) continue;
    const hasDecompose = detail.decomposeItems !== null && detail.decomposeItems !== undefined;
    const canCoinify = detail.isCoinifiable === true;
    const decompositions: StrategyStepResult[] = [];
    if (hasDecompose) {
      for (const catalystRank of CATALYST_RANKS) {
        try {
          const step = calculateDecompose({
            itemHrid, catalystRank, enhancementLevel: 0, profile, data, prices, buffs: alchemyBuffs,
          });
          decompositions.push(step);
          addCandidate(candidateFromStep(step, 'decompose', data));
        } catch { diagnostics.push(`decompose:${itemHrid}:c${catalystRank}`); }
      }
    }
    if (canCoinify) {
      for (const catalystRank of CATALYST_RANKS) {
        try {
          const step = calculateCoinify({ itemHrid, catalystRank, profile, data, prices, buffs: alchemyBuffs });
          addCandidate(candidateFromStep(step, 'coinify', data));
        } catch { diagnostics.push(`coinify:${itemHrid}:c${catalystRank}`); }
      }
    }
    for (const decompose of decompositions) {
      const outputItem = record(data.itemsByHrid.get(decompose.outputHrid));
      if (record(outputItem?.alchemyDetail)?.isCoinifiable !== true) continue;
      for (const catalystRank of CATALYST_RANKS) {
        try {
          const coinify = calculateCoinify({
            itemHrid: decompose.outputHrid, catalystRank, profile, data, prices, buffs: alchemyBuffs,
          });
          addCandidate(candidateFromWorkflow(calculateWorkflow([decompose, coinify]), 'decompose-coinify', data));
        } catch { diagnostics.push(`decompose-coinify:${itemHrid}:${decompose.id}:c${catalystRank}`); }
      }
    }
  }

  return {
    candidates: [...candidateMap.values()].sort((left, right) => (
      right.profitPerDay - left.profitPerDay || left.id.localeCompare(right.id)
    )),
    diagnostics,
  };
}
