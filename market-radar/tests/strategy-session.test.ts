import { describe, expect, it } from 'vitest';
import { estimateStrategySession, compareSessionRanking } from '../src/strategy/session';
import { evaluateRealizableStrategy } from '../src/strategy/realizable';
import type { StrategyCandidate } from '../src/strategy/candidates';
import type { PlayerProfile } from '../src/profile/types';
import type { Snapshot } from '../src/core/types';

const profile = { materialInventoryMap: {} } as PlayerProfile;
const snapshots: Snapshot[] = Array.from({ length: 168 }, (_, hour) => ({ timestamp: hour * 3600000,
  quotes: { '/items/input::0': { a: 10, b: 9, p: 10, v: 10000 },
    '/items/output::0': { a: 101, b: 100, p: 100, v: 1000 } } }));
function candidate(profit = 2000000, units = 100): StrategyCandidate {
  return { id: String(profit), kind: 'manufacture', title: 'test', path: ['/items/input', '/items/output'],
    profitPerHour: profit, profitPerDay: profit * 24, costPerHour: 10000, incomePerHour: profit + 10000,
    workingCapital24h: 240000, verificationStatus: 'unverified', steps: [{
      id: 'step', action: 'crafting', actionHrid: 'test', outputHrid: '/items/output', valid: true,
      actionsPerHour: 100, experiencePerHour: 1, costPerHour: 10000, incomePerHour: profit + 10000, profitPerHour: profit,
      inputs: [{ itemHrid: '/items/input', enhancementLevel: 0, unitsPerHour: 100, unitPrice: 10, market: true }],
      outputs: [{ itemHrid: '/items/output', enhancementLevel: 0, unitsPerHour: units, unitPrice: 100, market: true }],
    }] };
}
function session(c: StrategyCandidate, hours: number, history = snapshots) {
  return estimateStrategySession({ candidate: c, liquidity: evaluateRealizableStrategy(c, history),
    profile, plannedHours: hours, latestSnapshotAgeMs: 0 });
}
describe('duration-aware strategy estimates', () => {
  it('supports half-hour sessions without shrinking the 24h sale budget', () => {
    const value = session(candidate(), 0.5);
    expect(value.plannedHours).toBe(0.5);
    expect(value.executionHours).toBe(0.5);
    expect(value.batchProfit).toBe(1000000);
    expect(value.funding.cashRequired).toBe(5000); // includes costs not represented by market flows, such as coins
    expect(value.outputSharePct).toBeCloseTo(50 / 24000 * 100);
    expect(value.risk.riskLabel).toBe('低');
  });
  it('caps production and cash together, credits no unused time, exposes full-run excess', () => {
    const value = session(candidate(), 24);
    expect(value.executionHours).toBe(12);
    expect(value.batchProfit).toBe(24000000);
    expect(value.funding.cashRequired).toBe(120000);
    expect(value.durationCovered).toBe(false);
    expect(value.excessOutputUnits).toBe(1200);
    expect(value.risk.riskLabel).toBe('滯銷注意');
  });
  it('changes ranking between a short high-rate batch and sustained production', () => {
    const fast = candidate(3000000, 1200);
    const steady = candidate(1000000, 10);
    expect(session(fast, 0.5).batchProfit!).toBeGreaterThan(session(steady, 0.5).batchProfit!);
    expect(session(fast, 24).batchProfit!).toBeLessThan(session(steady, 24).batchProfit!);
  });
  it('never substitutes theoretical profit for missing liquidity', () => {
    const value = session(candidate(), 24, []);
    expect(value.rankValue).toBeNull();
    expect(value.actionable).toBe(false);
  });
  it('reduces funding by materials but never inflates economic earnings', () => {
    const c = candidate();
    const value = estimateStrategySession({ candidate: c, liquidity: evaluateRealizableStrategy(c, snapshots),
      profile: { materialInventoryMap: { '/items/input': 100 } } as unknown as PlayerProfile,
      plannedHours: 1, latestSnapshotAgeMs: 0 });
    expect(value.funding.cashRequired).toBe(9000);
    expect(value.batchProfit).toBe(2000000);
  });
  it('rejects stale recommendations and normalizes invalid/custom durations', () => {
    const c = candidate();
    expect(session(c, NaN).plannedHours).toBe(24);
    expect(session(c, -1).plannedHours).toBe(0.5);
    expect(session(c, 500).plannedHours).toBe(24);
    expect(estimateStrategySession({ candidate: c, liquidity: evaluateRealizableStrategy(c, snapshots), profile,
      plannedHours: 1, latestSnapshotAgeMs: 181 * 60000 }).rankValue).toBeNull();
  });
  it('sorts profit groups then priority, risk, lower funding and stable id', () => {
    const make = (profit: number, priority = 2, risk = 1, cash = 10, id = 'a') => ({ profit, priority, risk, cash, id });
    expect(compareSessionRanking(make(2200000, 1), make(2000000, 4))).toBeLessThan(0);
    expect(compareSessionRanking(make(2010000, 4), make(2090000, 1))).toBeLessThan(0);
    expect(compareSessionRanking(make(2010000, 2, 0), make(2090000, 2, 2))).toBeLessThan(0);
    expect(compareSessionRanking(make(2010000, 2, 1, 1), make(2090000, 2, 1, 10))).toBeLessThan(0);
    expect(compareSessionRanking({ ...make(1), profit: null }, make(1))).toBeGreaterThan(0);
  });
});
