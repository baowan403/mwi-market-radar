import { describe, expect, it } from 'vitest';
import { calculateWorkflow } from '../src/strategy/workflow';
import type { StrategyStepResult } from '../src/strategy/types';

function step(
  id: string,
  inputHrid: string,
  outputHrid: string,
  outputUnits: number,
  inputPrice: number,
  outputPrice: number,
): StrategyStepResult {
  return {
    id,
    action: 'crafting',
    actionHrid: `/actions/crafting/${id}`,
    outputHrid,
    valid: true,
    actionsPerHour: 1,
    costPerHour: inputPrice,
    incomePerHour: outputUnits * outputPrice * 0.95,
    profitPerHour: outputUnits * outputPrice * 0.95 - inputPrice,
    experiencePerHour: 10,
    inputs: [{ itemHrid: inputHrid, enhancementLevel: 0, unitsPerHour: 1, unitPrice: inputPrice, market: true }],
    outputs: [{ itemHrid: outputHrid, enhancementLevel: 0, unitsPerHour: outputUnits, unitPrice: outputPrice, market: true }],
  };
}

describe('balanced multi-step workflows', () => {
  it('balances stage time and removes internal intermediates', () => {
    const result = calculateWorkflow([
      step('a-to-b', '/items/a', '/items/b', 2, 10, 20),
      step('b-to-c', '/items/b', '/items/c', 3, 20, 30),
      step('c-to-d', '/items/c', '/items/d', 5, 30, 40),
      step('d-to-e', '/items/d', '/items/e', 7, 40, 50),
    ]);

    expect(result.steps.map((item) => item.workFraction)).toEqual([
      1 / 39,
      2 / 39,
      6 / 39,
      30 / 39,
    ]);
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0]?.itemHrid).toBe('/items/a');
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]?.itemHrid).toBe('/items/e');
    expect(result.costPerHour).toBeCloseTo(10 / 39);
    expect(result.incomePerHour).toBeCloseTo(7 * 50 * 0.95 * 30 / 39);
    expect(result.profitPerHour).toBeCloseTo(result.incomePerHour! - result.costPerHour!);
  });

  it('rejects cycles, invalid links, and workflows over seven steps', () => {
    const aToB = step('a-to-b', '/items/a', '/items/b', 2, 10, 20);
    const bToA = step('b-to-a', '/items/b', '/items/a', 2, 20, 10);
    expect(() => calculateWorkflow([aToB, bToA])).toThrow('策略工作流無法使用');
    expect(() => calculateWorkflow([
      aToB,
      step('x-to-y', '/items/x', '/items/y', 1, 1, 1),
    ])).toThrow('策略工作流無法使用');
    expect(() => calculateWorkflow(Array.from({ length: 8 }, (_, index) => (
      step(`s${index}`, `/items/${index}`, `/items/${index + 1}`, 1, 1, 1)
    )))).toThrow('策略工作流無法使用');
  });
});
