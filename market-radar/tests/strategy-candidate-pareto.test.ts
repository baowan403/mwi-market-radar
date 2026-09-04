import { describe, expect, it } from 'vitest';
import { selectParetoStrategyVariants, type StrategyCandidate } from '../src/strategy/candidates';

function candidate(id: string, profitPerHour: number, workingCapital24h: number): StrategyCandidate {
  return {
    id, kind: 'decompose', title: id,
    path: ['/items/input', '/items/output'],
    profitPerHour,
    profitPerDay: profitPerHour * 24,
    costPerHour: workingCapital24h / 24,
    incomePerHour: workingCapital24h / 24 + profitPerHour,
    workingCapital24h,
    steps: [],
    verificationStatus: 'unverified',
  };
}

describe('Pareto strategy variants', () => {
  it('keeps profit/capital tradeoffs and removes fully dominated or exact duplicate variants', () => {
    const result = selectParetoStrategyVariants([
      candidate('cheap', 90, 1_000),
      candidate('profitable', 100, 2_000),
      candidate('dominated', 80, 2_500),
      candidate('profitable-copy', 100, 2_000),
    ]);

    expect(result.map((item) => item.id)).toEqual(['cheap', 'profitable']);
  });
});
