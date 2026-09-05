import 'fake-indexeddb/auto';
import strategyDataJson from '../scripts/vendor/milkonomy/strategy-data.json';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketKey, Quote, Snapshot } from '../src/core/types';
import type { StrategyCandidate } from '../src/strategy/candidates';
import { normalizeStrategyGameData } from '../src/strategy/game-data';
import {
  MAX_OPPORTUNITY_RECORDS,
  OPPORTUNITY_DATABASE_NAME,
  OPPORTUNITY_DATABASE_VERSION,
  OPPORTUNITY_OUTCOME_STORE_NAME,
  OPPORTUNITY_STORE_NAME,
  createMemoryOpportunityJournal,
  createOpportunityJournal,
  evaluateOpportunityOutcome,
  makeOpportunityObservation,
  type OpportunityJournal,
  type OpportunityObservation,
  type OpportunityOutcome,
} from '../src/strategy/opportunity-journal';

const HOUR = 3_600_000;
const DATA = normalizeStrategyGameData(strategyDataJson);
const ISSUED_AT = 168 * HOUR;

function quote(overrides: Partial<Quote> = {}): Quote {
  return { a: 101, b: 100, p: 100, v: 10_000, ...overrides };
}

function candidate(
  id: string,
  outputUnits = 1,
  inputUnits = 1,
): StrategyCandidate {
  return {
    id,
    kind: 'manufacture',
    title: id,
    path: ['/items/input', '/items/output'],
    profitPerHour: 80,
    profitPerDay: 1_920,
    costPerHour: 20,
    incomePerHour: 100,
    workingCapital24h: 480,
    verificationStatus: 'unverified',
    steps: [{
      id,
      action: 'crafting',
      actionHrid: `/actions/crafting/${id}`,
      outputHrid: '/items/output',
      valid: true,
      actionsPerHour: 1,
      costPerHour: 20,
      incomePerHour: 100,
      profitPerHour: 80,
      experiencePerHour: 1,
      inputs: [{
        itemHrid: '/items/input', enhancementLevel: 0, unitsPerHour: inputUnits, unitPrice: 20, market: true,
      }],
      outputs: [{
        itemHrid: '/items/output', enhancementLevel: 0, unitsPerHour: outputUnits, unitPrice: 100, market: true,
      }],
    }],
  };
}

async function observation(overrides: Partial<Omit<OpportunityObservation, 'id'>> = {}): Promise<OpportunityObservation> {
  const issuedAt = overrides.issuedAt ?? ISSUED_AT;
  return makeOpportunityObservation({
    profileId: 'profile-a',
    issuedAt,
    savedAt: overrides.savedAt ?? issuedAt + 1_000,
    plannedHours: 6,
    action: 'watch',
    sourceTimestamp: overrides.sourceTimestamp ?? ISSUED_AT,
    candidate: candidate('candidate'),
    baseline: candidate('baseline', 2),
    ...overrides,
  });
}

function history(
  endHour = 175,
  mutate?: (hour: number, quotes: Record<MarketKey, Quote>) => void,
): Snapshot[] {
  return Array.from({ length: endHour + 1 }, (_, hour) => {
    const quotes: Record<MarketKey, Quote> = {
      '/items/input::0': quote({ a: 20, b: 19, p: 20 }),
      '/items/output::0': quote({ a: 110, b: 100, p: 100 }),
    };
    mutate?.(hour, quotes);
    return { timestamp: hour * HOUR, quotes };
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OPPORTUNITY_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
    request.onblocked = () => reject(new Error('delete blocked'));
  });
}

async function putRaw(value: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OPPORTUNITY_DATABASE_NAME, OPPORTUNITY_DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OPPORTUNITY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(OPPORTUNITY_STORE_NAME);
    store.put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('put failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('put aborted'));
  });
  database.close();
}

const stores: OpportunityJournal[] = [];

function evaluatedOutcome(horizonHours: 6 | 24 = 6): OpportunityOutcome {
  return {
    state: 'evaluated',
    horizonHours,
    observedAt: ISSUED_AT + horizonHours * HOUR,
    candidateProfit: 120,
    baselineProfit: 100,
    extraProfit: 20,
    maxRelativeShortfall: 30,
  };
}

beforeEach(deleteDatabase);
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await deleteDatabase();
});

describe('opportunity observation identity and memory journal', () => {
  it('hashes frozen configuration while excluding savedAt from deduplication', async () => {
    const first = await observation({ savedAt: ISSUED_AT + 1_000 });
    const second = await observation({ savedAt: ISSUED_AT + 2_000 });
    const sameSourceLater = await observation({ issuedAt: ISSUED_AT + HOUR, sourceTimestamp: ISSUED_AT });
    const changed = await observation({ candidate: candidate('changed'), savedAt: ISSUED_AT + 2_000 });

    expect(first.id).toBe(second.id);
    expect(sameSourceLater.id).toBe(first.id);
    expect(changed.id).not.toBe(first.id);

    const source = candidate('source');
    const frozen = await observation({ candidate: source });
    source.title = 'mutated after save';
    source.steps[0]!.outputs[0]!.unitsPerHour = 999;
    expect(frozen.candidate.title).toBe('source');
    expect(frozen.candidate.steps[0]!.outputs[0]!.unitsPerHour).toBe(1);

    const journal = createMemoryOpportunityJournal();
    stores.push(journal);
    await journal.add(first);
    await journal.add(second);
    const listed = await journal.list('profile-a');
    expect(listed).toHaveLength(1);
    listed[0]!.candidate.title = 'mutated returned clone';
    expect((await journal.list('profile-a'))[0]!.candidate.title).toBe('candidate');
  });

  it('isolates profiles and rejects use after close', async () => {
    const journal = createMemoryOpportunityJournal();
    stores.push(journal);
    await journal.add(await observation({ profileId: 'profile-a' }));
    await journal.add(await observation({ profileId: 'profile-b' }));
    expect((await journal.list('profile-a')).every((item) => item.profileId === 'profile-a')).toBe(true);
    expect(await journal.list('profile-a')).toHaveLength(1);
    expect(await journal.list('profile-c')).toEqual([]);
    journal.close();
    await expect(journal.list('profile-a')).rejects.toMatchObject({ code: 'opportunity_storage' });
    await expect(journal.add(await observation())).rejects.toMatchObject({ code: 'opportunity_storage' });
  });

  it('round-trips alchemy and workflow step extensions without dropping physical fields', async () => {
    const extended = candidate('extended');
    Object.assign(extended.steps[0]!, { successRate: 0.75, catalystRank: 2, workFraction: 0.4 });
    const journal = createMemoryOpportunityJournal();
    stores.push(journal);
    const record = await observation({ candidate: extended });
    await journal.add(record);
    const restored = (await journal.list('profile-a'))[0]!;
    expect(restored.candidate.steps[0]).toMatchObject({ successRate: 0.75, catalystRank: 2, workFraction: 0.4 });
    expect(restored.candidate.steps[0]!.inputs[0]!.unitsPerHour).toBe(1);
    expect(restored.candidate.steps[0]!.outputs[0]!.unitsPerHour).toBe(1);
  });
});

describe('indexed opportunity journal', () => {
  it('persists immutable records across adapter restarts', async () => {
    const first = createOpportunityJournal();
    stores.push(first);
    const record = await observation();
    await first.add(record);
    first.close();

    const second = createOpportunityJournal();
    stores.push(second);
    const listed = await second.list('profile-a');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(record);
    listed[0]!.baseline.title = 'corrupt returned clone';
    expect((await second.list('profile-a'))[0]!.baseline.title).toBe('baseline');
  });

  it('enforces a bounded total record count and rejects corrupt stored records', async () => {
    const journal = createOpportunityJournal();
    stores.push(journal);
    for (let index = 0; index < MAX_OPPORTUNITY_RECORDS; index += 1) {
      await journal.add(await observation({ profileId: `profile-${index}`, issuedAt: ISSUED_AT + index * HOUR }));
    }
    await journal.add(await observation({ profileId: 'overflow', issuedAt: ISSUED_AT + 500 * HOUR }));
    expect(await journal.list('profile-0')).toEqual([]);
    expect(await journal.list('overflow')).toHaveLength(1);
    const retained = await Promise.all([
      ...Array.from({ length: MAX_OPPORTUNITY_RECORDS - 1 }, (_, index) => journal.list(`profile-${index + 1}`)),
      journal.list('overflow'),
    ]);
    expect(retained.flat()).toHaveLength(MAX_OPPORTUNITY_RECORDS);
    await putRaw({ id: 'corrupt', profileId: 'profile-a' });
    await expect(journal.list('profile-a')).rejects.toMatchObject({ code: 'opportunity_storage' });
  }, 30_000);

  it('does not pretend IndexedDB persistence exists when no factory is available', async () => {
    const journal = createOpportunityJournal({ indexedDB: {} as IDBFactory });
    stores.push(journal);
    await expect(journal.list('profile-a')).rejects.toMatchObject({ code: 'opportunity_storage' });
  });
});

describe('opportunity outcome cache', () => {
  it('stores only evaluated finite outcomes, keeps the first write, and clones results', async () => {
    const journal = createMemoryOpportunityJournal();
    stores.push(journal);
    const record = await observation();
    await journal.add(record);
    const outcome = evaluatedOutcome();
    await journal.saveOutcome(record.id, outcome);
    const loaded = await journal.getOutcome(record.id, 6);
    expect(loaded).toEqual(outcome);
    loaded!.candidateProfit = 999;
    await journal.saveOutcome(record.id, { ...outcome, candidateProfit: 999 });
    expect(await journal.getOutcome(record.id, 6)).toEqual(outcome);
    await expect(journal.saveOutcome('missing', outcome)).rejects.toMatchObject({ code: 'opportunity_storage' });
    await expect(journal.saveOutcome(record.id, { ...outcome, state: 'pending' })).rejects.toMatchObject({ code: 'opportunity_storage' });
    await expect(journal.saveOutcome(record.id, { ...outcome, candidateProfit: Number.NaN })).rejects.toMatchObject({ code: 'opportunity_storage' });
    expect(await journal.getOutcome(record.id, 24)).toBeNull();
  });

  it('persists cached outcomes across IndexedDB restarts in the version-two outcomes store', async () => {
    const record = await observation();
    const first = createOpportunityJournal();
    stores.push(first);
    await first.add(record);
    await first.saveOutcome(record.id, evaluatedOutcome(24));
    first.close();

    const second = createOpportunityJournal();
    stores.push(second);
    await expect(second.getOutcome(record.id, 24)).resolves.toEqual(evaluatedOutcome(24));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(OPPORTUNITY_DATABASE_NAME, OPPORTUNITY_DATABASE_VERSION);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
      request.onsuccess = () => resolve(request.result);
    });
    expect(database.version).toBe(2);
    expect([...database.objectStoreNames]).toEqual([OPPORTUNITY_STORE_NAME, OPPORTUNITY_OUTCOME_STORE_NAME]);
    database.close();
  });

  it('evicts cached outcomes together with the oldest observation', async () => {
    const journal = createMemoryOpportunityJournal();
    stores.push(journal);
    const records: OpportunityObservation[] = [];
    for (let index = 0; index < MAX_OPPORTUNITY_RECORDS; index += 1) {
      const record = await observation({ profileId: `profile-${index}`, issuedAt: ISSUED_AT + index * HOUR });
      records.push(record);
      await journal.add(record);
    }
    await journal.saveOutcome(records[0]!.id, evaluatedOutcome());
    await journal.add(await observation({ profileId: 'new-profile', issuedAt: ISSUED_AT + MAX_OPPORTUNITY_RECORDS * HOUR }));
    expect(await journal.getOutcome(records[0]!.id, 6)).toBeNull();
  }, 30_000);
});

describe('opportunity outcomes', () => {
  it('evaluates at the first target snapshot and reports negative relative extra profit', async () => {
    const record = await observation({ plannedHours: 6 });
    const result = evaluateOpportunityOutcome(record, history(180, (hour, quotes) => {
      if (hour >= 174) quotes['/items/output::0'] = quote({ a: 160, b: 150, p: 150 });
    }), DATA, 6);

    expect(result.state).toBe('evaluated');
    expect(result.horizonHours).toBe(6);
    expect(result.observedAt).toBe(174 * HOUR);
    expect(result.candidateProfit).not.toBeNull();
    expect(result.baselineProfit).not.toBeNull();
    expect(result.extraProfit).not.toBeNull();
    expect(result.extraProfit!).toBeLessThan(0);
    expect(result.maxRelativeShortfall).toBeGreaterThanOrEqual(0);
  });

  it('does not leak prices or capacity from snapshots after the observation timestamp', async () => {
    const record = await observation({ plannedHours: 6 });
    const before = history(174, (hour, quotes) => {
      if (hour === 174) quotes['/items/output::0'] = quote({ a: 120, b: 110, p: 110 });
    });
    const after = [...before, {
      timestamp: 180 * HOUR,
      quotes: {
        '/items/input::0': quote({ a: 1, b: 1, p: 1, v: 1_000_000 }),
        '/items/output::0': quote({ a: 1_000_000, b: 1_000_000, p: 1_000_000, v: 1_000_000 }),
      },
    }];
    expect(evaluateOpportunityOutcome(record, after, DATA, 6))
      .toEqual(evaluateOpportunityOutcome(record, before, DATA, 6));
  });

  it('returns pending before the target and missing after a target window with no adequate observation', async () => {
    const record = await observation({ plannedHours: 6 });
    expect(evaluateOpportunityOutcome(record, history(173), DATA, 6)).toMatchObject({
      state: 'pending', horizonHours: 6, observedAt: null,
      candidateProfit: null, baselineProfit: null, extraProfit: null, maxRelativeShortfall: null,
    });
    expect(evaluateOpportunityOutcome(record, history(176, (hour, quotes) => {
      if (hour === 174) delete quotes['/items/output::0'];
    }), DATA, 6)).toMatchObject({
      state: 'missing', horizonHours: 6, observedAt: null,
      candidateProfit: null, baselineProfit: null, extraProfit: null, maxRelativeShortfall: null,
    });
    expect(evaluateOpportunityOutcome(record, history(174, (_hour, quotes) => {
      quotes['/items/input::0']!.v = 0;
      quotes['/items/output::0']!.v = 0;
    }), DATA, 6)).toMatchObject({ state: 'missing', observedAt: null });
  });

  it('uses the frozen candidate and baseline configuration at outcome time', async () => {
    const source = candidate('source');
    const record = await observation({ candidate: source, plannedHours: 6 });
    source.profitPerHour = -999_999;
    source.steps[0]!.outputs[0]!.unitsPerHour = 999;
    const frozen = evaluateOpportunityOutcome(record, history(174), DATA, 6);
    const fresh = evaluateOpportunityOutcome(await observation({ plannedHours: 6 }), history(174), DATA, 6);
    expect(frozen.candidateProfit).toBe(fresh.candidateProfit);
    expect(record.candidate.profitPerHour).toBe(80);
  });
});
