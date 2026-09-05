import type { PlayerProfile } from '../profile/types';
import type { MarketKey, Snapshot } from '../core/types';
import type { StrategyCandidate } from './candidates';
import { createStrategyPriceBook } from './price-book';
import { repriceFixedCandidate } from './margin-series';
import { evaluateRealizableStrategy } from './realizable';
import { estimateStrategySession } from './session';
import type { NormalizedStrategyGameData } from './game-data';
import type { StrategyFlow, StrategyStepResult } from './types';

export const OPPORTUNITY_DATABASE_NAME = 'mwi-market-radar-opportunities';
export const OPPORTUNITY_DATABASE_VERSION = 2;
export const OPPORTUNITY_STORE_NAME = 'opportunities';
export const OPPORTUNITY_OUTCOME_STORE_NAME = 'outcomes';
export const MAX_OPPORTUNITY_RECORDS = 120;
export const MAX_OPPORTUNITY_RECORD_BYTES = 512 * 1024;

const HOUR_MS = 3_600_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_PROFILE_ID_LENGTH = 256;
const MAX_STRING_LENGTH = 8_192;
const MAX_PATH_LENGTH = 128;
const MAX_STEPS = 64;
const MAX_FLOWS_PER_STEP = 256;
const OPPORTUNITY_KEYS = [
  'id', 'profileId', 'issuedAt', 'savedAt', 'sourceTimestamp', 'plannedHours', 'action', 'candidate', 'baseline',
] as const;
const OPPORTUNITY_OUTCOME_KEYS = [
  'state', 'horizonHours', 'observedAt', 'candidateProfit', 'baselineProfit', 'extraProfit', 'maxRelativeShortfall',
] as const;
const CANDIDATE_KINDS = new Set<StrategyCandidate['kind']>([
  'manufacture', 'workflow', 'transmute', 'decompose', 'coinify', 'decompose-coinify', 'gather',
]);
const VERIFICATION_STATUSES = new Set<StrategyCandidate['verificationStatus']>([
  'verified', 'mk-parity', 'disputed', 'unverified',
]);
const INVALID_OUTCOME_RISK_CODES = new Set([
  'market-unavailable', 'no-ask', 'no-bid', 'price-anomaly', 'insufficient-primary-data', 'insufficient-input-data',
]);

export interface OpportunityObservation {
  id: string;
  profileId: string;
  issuedAt: number;
  savedAt: number;
  sourceTimestamp: number;
  plannedHours: number;
  action: 'watch' | 'prepare';
  candidate: StrategyCandidate;
  baseline: StrategyCandidate;
}

export type OpportunityObservationInput = Omit<OpportunityObservation, 'id' | 'sourceTimestamp'> & {
  sourceTimestamp?: number;
};

export interface OpportunityJournal {
  list(profileId: string): Promise<OpportunityObservation[]>;
  add(record: OpportunityObservation): Promise<void>;
  getOutcome(recordId: string, horizonHours: 6 | 24): Promise<OpportunityOutcome | null>;
  saveOutcome(recordId: string, outcome: OpportunityOutcome): Promise<void>;
  close(): void;
}

export class OpportunityJournalError extends Error {
  readonly code = 'opportunity_storage';

  constructor() {
    super('Opportunity journal storage is unavailable');
    this.name = 'OpportunityJournalError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface OpportunityOutcome {
  state: 'pending' | 'missing' | 'evaluated';
  horizonHours: 6 | 24;
  observedAt: number | null;
  candidateProfit: number | null;
  baselineProfit: number | null;
  extraProfit: number | null;
  maxRelativeShortfall: number | null;
}

interface StoredOpportunityOutcome {
  key: string;
  recordId: string;
  horizonHours: 6 | 24;
  outcome: OpportunityOutcome;
}

function storageError(): OpportunityJournalError {
  return new OpportunityJournalError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validString(value: unknown, maximum = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validProfileId(value: unknown): value is string {
  return validString(value, MAX_PROFILE_ID_LENGTH);
}

function validDate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_DATE_MS;
}

function validFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validNonnegativeNumber(value: unknown): value is number {
  return validFiniteNumber(value) && value >= 0;
}

function validNullableNumber(value: unknown): value is number | null {
  return value === null || validFiniteNumber(value);
}

function validHorizon(value: unknown): value is 6 | 24 {
  return value === 6 || value === 24;
}

function outcomeKey(recordId: string, horizonHours: 6 | 24): string {
  return `${recordId}|${horizonHours}`;
}

function validateOutcome(value: unknown, expectedHorizon?: 6 | 24): OpportunityOutcome {
  if (!isRecord(value) || !hasExactKeys(value, OPPORTUNITY_OUTCOME_KEYS)
    || value.state !== 'evaluated'
    || !validHorizon(value.horizonHours)
    || (expectedHorizon !== undefined && value.horizonHours !== expectedHorizon)
    || !validDate(value.observedAt)
    || !validFiniteNumber(value.candidateProfit)
    || !validFiniteNumber(value.baselineProfit)
    || !validFiniteNumber(value.extraProfit)
    || !validFiniteNumber(value.maxRelativeShortfall)
    || value.maxRelativeShortfall < 0) {
    throw storageError();
  }
  return clone({
    state: 'evaluated',
    horizonHours: value.horizonHours,
    observedAt: value.observedAt,
    candidateProfit: value.candidateProfit,
    baselineProfit: value.baselineProfit,
    extraProfit: value.extraProfit,
    maxRelativeShortfall: value.maxRelativeShortfall,
  });
}

function validateStoredOutcome(value: unknown): StoredOpportunityOutcome {
  if (!isRecord(value) || !hasExactKeys(value, ['key', 'recordId', 'horizonHours', 'outcome'])
    || !validString(value.recordId, 128)
    || !validHorizon(value.horizonHours)
    || value.key !== outcomeKey(value.recordId, value.horizonHours)) throw storageError();
  const outcome = validateOutcome(value.outcome, value.horizonHours);
  return clone({
    key: value.key,
    recordId: value.recordId,
    horizonHours: value.horizonHours,
    outcome,
  });
}

function validFlow(value: unknown): value is StrategyFlow {
  if (!isRecord(value) || !hasExactKeys(value, ['itemHrid', 'enhancementLevel', 'unitsPerHour', 'unitPrice', 'market'])) return false;
  return validString(value.itemHrid)
    && Number.isSafeInteger(value.enhancementLevel)
    && (value.enhancementLevel as number) >= 0
    && validNonnegativeNumber(value.unitsPerHour)
    && (value.unitPrice === null || validNonnegativeNumber(value.unitPrice))
    && typeof value.market === 'boolean';
}

function validStep(value: unknown): value is StrategyStepResult {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'ledger' && ![
    'id', 'action', 'actionHrid', 'outputHrid', 'valid', 'actionsPerHour', 'costPerHour',
    'incomePerHour', 'profitPerHour', 'experiencePerHour', 'inputs', 'outputs',
    'successRate', 'catalystRank', 'workFraction',
  ].includes(key))) return false;
  if (![
    'id', 'action', 'actionHrid', 'outputHrid', 'valid', 'actionsPerHour', 'costPerHour',
    'incomePerHour', 'profitPerHour', 'experiencePerHour', 'inputs', 'outputs',
  ].every((key) => Object.hasOwn(value, key))) return false;
  return validString(value.id)
    && validString(value.action)
    && validString(value.actionHrid)
    && validString(value.outputHrid)
    && typeof value.valid === 'boolean'
    && validNonnegativeNumber(value.actionsPerHour)
    && validNullableNumber(value.costPerHour)
    && validNullableNumber(value.incomePerHour)
    && validNullableNumber(value.profitPerHour)
    && validNonnegativeNumber(value.experiencePerHour)
    && Array.isArray(value.inputs)
    && value.inputs.length <= MAX_FLOWS_PER_STEP
    && value.inputs.every(validFlow)
    && Array.isArray(value.outputs)
    && value.outputs.length <= MAX_FLOWS_PER_STEP
    && value.outputs.every(validFlow)
    && (!Object.hasOwn(value, 'successRate')
      || (validFiniteNumber(value.successRate) && value.successRate >= 0 && value.successRate <= 1))
    && (!Object.hasOwn(value, 'catalystRank')
      || (Number.isSafeInteger(value.catalystRank) && (value.catalystRank as number) >= 0 && (value.catalystRank as number) <= 2))
    && (!Object.hasOwn(value, 'workFraction')
      || (validFiniteNumber(value.workFraction) && value.workFraction >= 0 && value.workFraction <= 1));
}

function validCandidate(value: unknown): value is StrategyCandidate {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'kind', 'title', 'path', 'profitPerHour', 'profitPerDay', 'costPerHour', 'incomePerHour',
    'workingCapital24h', 'steps', 'verificationStatus',
  ])) return false;
  return validString(value.id)
    && typeof value.kind === 'string'
    && CANDIDATE_KINDS.has(value.kind as StrategyCandidate['kind'])
    && validString(value.title)
    && Array.isArray(value.path)
    && value.path.length <= MAX_PATH_LENGTH
    && value.path.every((item) => validString(item))
    && validFiniteNumber(value.profitPerHour)
    && validFiniteNumber(value.profitPerDay)
    && validFiniteNumber(value.costPerHour)
    && validFiniteNumber(value.incomePerHour)
    && validFiniteNumber(value.workingCapital24h)
    && Array.isArray(value.steps)
    && value.steps.length <= MAX_STEPS
    && value.steps.every(validStep)
    && typeof value.verificationStatus === 'string'
    && VERIFICATION_STATUSES.has(value.verificationStatus as StrategyCandidate['verificationStatus']);
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw storageError();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw storageError();
    seen.add(value);
    const result = `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  if (!isRecord(value)) throw storageError();
  if (seen.has(value)) throw storageError();
  seen.add(value);
  const result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}

function serializedBytes(value: unknown): number {
  const text = canonicalJson(value);
  return new TextEncoder().encode(text).byteLength;
}

function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw storageError();
  }
}

function hashIdentity(value: string): string {
  // FNV-1a is deterministic, synchronous, and available in every target;
  // the full canonical payload remains the source of truth for collision checks.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

interface NormalizedOpportunityObservationInput extends Omit<OpportunityObservationInput, 'sourceTimestamp'> {
  sourceTimestamp: number;
}

function identityPayload(input: NormalizedOpportunityObservationInput): Record<string, unknown> {
  return {
    profileId: input.profileId,
    sourceTimestamp: input.sourceTimestamp,
    plannedHours: input.plannedHours,
    action: input.action,
    candidate: input.candidate,
    baseline: input.baseline,
  };
}

function identityFor(input: NormalizedOpportunityObservationInput): string {
  return `opportunity-${hashIdentity(canonicalJson(identityPayload(input)))}`;
}

function normalizedInput(input: OpportunityObservationInput): NormalizedOpportunityObservationInput {
  if (!isRecord(input)
    || !Object.hasOwn(input, 'profileId')
    || !Object.hasOwn(input, 'issuedAt')
    || !Object.hasOwn(input, 'savedAt')
    || !Object.hasOwn(input, 'plannedHours')
    || !Object.hasOwn(input, 'action')
    || !Object.hasOwn(input, 'candidate')
    || !Object.hasOwn(input, 'baseline')
    || (Object.hasOwn(input, 'sourceTimestamp') && input.sourceTimestamp === undefined)
    || !validProfileId(input.profileId)
    || !validDate(input.issuedAt)
    || !validDate(input.savedAt)
    || input.savedAt < input.issuedAt
    || (input.sourceTimestamp !== undefined && (
      !validDate(input.sourceTimestamp) || input.sourceTimestamp > input.issuedAt
    ))
    || !validFiniteNumber(input.plannedHours)
    || input.plannedHours < 0.5
    || input.plannedHours > 24
    || !['watch', 'prepare'].includes(input.action as string)
    || !validCandidate(input.candidate)
    || !validCandidate(input.baseline)) {
    throw storageError();
  }
  const normalized = {
    profileId: input.profileId,
    issuedAt: input.issuedAt,
    savedAt: input.savedAt,
    sourceTimestamp: input.sourceTimestamp ?? input.issuedAt,
    plannedHours: input.plannedHours,
    action: input.action,
    candidate: input.candidate,
    baseline: input.baseline,
  } as NormalizedOpportunityObservationInput;
  try {
    if (serializedBytes(normalized) > MAX_OPPORTUNITY_RECORD_BYTES) throw storageError();
  } catch (error) {
    if (error instanceof OpportunityJournalError) throw error;
    throw storageError();
  }
  return normalized;
}

function validateRecord(value: unknown): OpportunityObservation {
  if (!isRecord(value) || !hasExactKeys(value, OPPORTUNITY_KEYS)) throw storageError();
  const input = normalizedInput({
    profileId: value.profileId,
    issuedAt: value.issuedAt,
    savedAt: value.savedAt,
    sourceTimestamp: value.sourceTimestamp,
    plannedHours: value.plannedHours,
    action: value.action,
    candidate: value.candidate,
    baseline: value.baseline,
  } as OpportunityObservationInput);
  if (!validString(value.id, 128) || value.id !== identityFor(input)) throw storageError();
  const record = clone({
    id: value.id,
    ...input,
  });
  if (serializedBytes(record) > MAX_OPPORTUNITY_RECORD_BYTES) throw storageError();
  return record;
}

export async function makeOpportunityObservation(input: OpportunityObservationInput): Promise<OpportunityObservation> {
  const frozen = clone(normalizedInput(input));
  const id = identityFor(frozen);
  return clone({ id, ...frozen });
}

function sortObservations(values: OpportunityObservation[]): OpportunityObservation[] {
  return values.sort((left, right) => (
    left.issuedAt - right.issuedAt
    || left.savedAt - right.savedAt
    || left.id.localeCompare(right.id)
  ));
}

function oldestObservation(values: OpportunityObservation[]): OpportunityObservation | undefined {
  return [...values].sort((left, right) => (
    left.savedAt - right.savedAt
    || left.issuedAt - right.issuedAt
    || left.id.localeCompare(right.id)
  ))[0];
}

export function createMemoryOpportunityJournal(): OpportunityJournal {
  const records = new Map<string, OpportunityObservation>();
  const outcomes = new Map<string, OpportunityOutcome>();
  let closed = false;
  const ensureOpen = (): void => {
    if (closed) throw storageError();
  };
  return {
    async list(profileId: string): Promise<OpportunityObservation[]> {
      ensureOpen();
      if (!validProfileId(profileId)) throw storageError();
      return sortObservations([...records.values()]
        .filter((record) => record.profileId === profileId)
        .map((record) => clone(record)));
    },
    async add(record: OpportunityObservation): Promise<void> {
      ensureOpen();
      const valid = validateRecord(record);
      if (records.has(valid.id)) return;
      while (records.size >= MAX_OPPORTUNITY_RECORDS) {
        const oldest = oldestObservation([...records.values()]);
        if (!oldest) throw storageError();
        records.delete(oldest.id);
        outcomes.delete(outcomeKey(oldest.id, 6));
        outcomes.delete(outcomeKey(oldest.id, 24));
      }
      records.set(valid.id, valid);
    },
    async getOutcome(recordId: string, horizonHours: 6 | 24): Promise<OpportunityOutcome | null> {
      ensureOpen();
      if (!validString(recordId, 128) || !validHorizon(horizonHours)) throw storageError();
      if (!records.has(recordId)) return null;
      const value = outcomes.get(outcomeKey(recordId, horizonHours));
      return value === undefined ? null : clone(value);
    },
    async saveOutcome(recordId: string, outcome: OpportunityOutcome): Promise<void> {
      ensureOpen();
      if (!validString(recordId, 128) || !records.has(recordId)) throw storageError();
      const valid = validateOutcome(outcome);
      if (valid.horizonHours !== outcome.horizonHours) throw storageError();
      const key = outcomeKey(recordId, valid.horizonHours);
      if (outcomes.has(key)) return;
      outcomes.set(key, valid);
    },
    close(): void {
      closed = true;
    },
  };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(OPPORTUNITY_DATABASE_NAME, OPPORTUNITY_DATABASE_VERSION);
    } catch {
      reject(storageError());
      return;
    }
    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OPPORTUNITY_STORE_NAME)) {
        database.createObjectStore(OPPORTUNITY_STORE_NAME, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(OPPORTUNITY_OUTCOME_STORE_NAME)) {
        database.createObjectStore(OPPORTUNITY_OUTCOME_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onerror = (): void => reject(storageError());
    request.onblocked = (): void => reject(storageError());
    request.onsuccess = (): void => resolve(request.result);
  });
}

function readAll(database: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    let values: unknown[] | null = null;
    let failed = false;
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(OPPORTUNITY_STORE_NAME, 'readonly');
    } catch {
      reject(storageError());
      return;
    }
    transaction.oncomplete = (): void => {
      if (!failed) resolve(values ?? []);
    };
    transaction.onerror = (): void => {
      failed = true;
      reject(storageError());
    };
    transaction.onabort = (): void => {
      failed = true;
      reject(storageError());
    };
    const request = transaction.objectStore(OPPORTUNITY_STORE_NAME).getAll();
    request.onsuccess = (): void => {
      if (Array.isArray(request.result)) values = request.result;
      else {
        failed = true;
        reject(storageError());
      }
    };
    request.onerror = (): void => {
      failed = true;
      reject(storageError());
    };
  });
}

function addRecord(database: IDBDatabase, record: OpportunityObservation): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(
        [OPPORTUNITY_STORE_NAME, OPPORTUNITY_OUTCOME_STORE_NAME],
        'readwrite',
      );
    } catch {
      reject(storageError());
      return;
    }
    const store = transaction.objectStore(OPPORTUNITY_STORE_NAME);
    const outcomeStore = transaction.objectStore(OPPORTUNITY_OUTCOME_STORE_NAME);
    let failure: OpportunityJournalError | null = null;
    let addStarted = false;
    transaction.oncomplete = (): void => {
      if (failure) reject(failure);
      else resolve();
    };
    transaction.onerror = (): void => {
      if (!failure) failure = storageError();
      reject(failure);
    };
    transaction.onabort = (): void => {
      reject(failure ?? storageError());
    };

    const existingRequest = store.get(record.id);
    existingRequest.onerror = (): void => {
      failure = storageError();
      transaction.abort();
    };
    existingRequest.onsuccess = (): void => {
      if (existingRequest.result !== undefined) {
        try {
          validateRecord(existingRequest.result);
        } catch {
          failure = storageError();
          transaction.abort();
        }
        return;
      }

      const countRequest = store.count();
      countRequest.onerror = (): void => {
        failure = storageError();
        transaction.abort();
      };
      countRequest.onsuccess = (): void => {
        if (addStarted) return;
        addStarted = true;
        const queueAdd = (): void => {
          const addRequest = store.add(clone(record));
          addRequest.onerror = (event): void => {
            if (addRequest.error?.name === 'ConstraintError') {
              event.preventDefault();
              return;
            }
            failure = storageError();
            transaction.abort();
          };
        };
        if (countRequest.result < MAX_OPPORTUNITY_RECORDS) {
          queueAdd();
          return;
        }
        const allRequest = store.getAll();
        allRequest.onerror = (): void => {
          failure = storageError();
          transaction.abort();
        };
        allRequest.onsuccess = (): void => {
          if (!Array.isArray(allRequest.result)) {
            failure = storageError();
            transaction.abort();
            return;
          }
          let existing: OpportunityObservation[];
          try {
            existing = allRequest.result.map(validateRecord);
          } catch {
            failure = storageError();
            transaction.abort();
            return;
          }
          const removeCount = Math.max(1, existing.length - MAX_OPPORTUNITY_RECORDS + 1);
          const oldest = [...existing].sort((left, right) => (
            left.savedAt - right.savedAt
            || left.issuedAt - right.issuedAt
            || left.id.localeCompare(right.id)
          ));
          for (const value of oldest.slice(0, removeCount)) {
            store.delete(value.id);
            outcomeStore.delete(outcomeKey(value.id, 6));
            outcomeStore.delete(outcomeKey(value.id, 24));
          }
          queueAdd();
        };
      };
    };
  });
}

function readOutcome(
  database: IDBDatabase,
  recordId: string,
  horizonHours: 6 | 24,
): Promise<OpportunityOutcome | null> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(
        [OPPORTUNITY_STORE_NAME, OPPORTUNITY_OUTCOME_STORE_NAME],
        'readonly',
      );
    } catch {
      reject(storageError());
      return;
    }
    let recordValue: unknown;
    let outcomeValue: unknown;
    let recordRead = false;
    let outcomeRead = false;
    let failed = false;
    transaction.oncomplete = (): void => {
      if (failed || !recordRead || !outcomeRead) return;
      try {
        if (recordValue === undefined) {
          if (outcomeValue !== undefined) throw storageError();
          resolve(null);
          return;
        }
        validateRecord(recordValue);
        if (outcomeValue === undefined) {
          resolve(null);
          return;
        }
        resolve(validateStoredOutcome(outcomeValue).outcome);
      } catch {
        reject(storageError());
      }
    };
    transaction.onerror = (): void => {
      failed = true;
      reject(storageError());
    };
    transaction.onabort = (): void => {
      failed = true;
      reject(storageError());
    };
    const recordRequest = transaction.objectStore(OPPORTUNITY_STORE_NAME).get(recordId);
    recordRequest.onsuccess = (): void => {
      recordValue = recordRequest.result;
      recordRead = true;
    };
    recordRequest.onerror = (): void => {
      failed = true;
      transaction.abort();
    };
    const outcomeRequest = transaction.objectStore(OPPORTUNITY_OUTCOME_STORE_NAME)
      .get(outcomeKey(recordId, horizonHours));
    outcomeRequest.onsuccess = (): void => {
      outcomeValue = outcomeRequest.result;
      outcomeRead = true;
    };
    outcomeRequest.onerror = (): void => {
      failed = true;
      transaction.abort();
    };
  });
}

function saveOutcomeRecord(
  database: IDBDatabase,
  recordId: string,
  outcome: OpportunityOutcome,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(
        [OPPORTUNITY_STORE_NAME, OPPORTUNITY_OUTCOME_STORE_NAME],
        'readwrite',
      );
    } catch {
      reject(storageError());
      return;
    }
    const recordStore = transaction.objectStore(OPPORTUNITY_STORE_NAME);
    const outcomeStore = transaction.objectStore(OPPORTUNITY_OUTCOME_STORE_NAME);
    let failure: OpportunityJournalError | null = null;
    let outcomeWriteStarted = false;
    transaction.oncomplete = (): void => {
      if (failure) reject(failure);
      else resolve();
    };
    transaction.onerror = (): void => {
      if (!failure) failure = storageError();
      reject(failure);
    };
    transaction.onabort = (): void => {
      reject(failure ?? storageError());
    };

    const recordRequest = recordStore.get(recordId);
    recordRequest.onerror = (): void => {
      failure = storageError();
      transaction.abort();
    };
    recordRequest.onsuccess = (): void => {
      if (recordRequest.result === undefined) {
        failure = storageError();
        transaction.abort();
        return;
      }
      try {
        validateRecord(recordRequest.result);
      } catch {
        failure = storageError();
        transaction.abort();
        return;
      }
      const key = outcomeKey(recordId, outcome.horizonHours);
      const existingRequest = outcomeStore.get(key);
      existingRequest.onerror = (): void => {
        failure = storageError();
        transaction.abort();
      };
      existingRequest.onsuccess = (): void => {
        if (existingRequest.result !== undefined) {
          try {
            validateStoredOutcome(existingRequest.result);
          } catch {
            failure = storageError();
            transaction.abort();
          }
          return;
        }
        if (outcomeWriteStarted) return;
        outcomeWriteStarted = true;
        const request = outcomeStore.add({
          key,
          recordId,
          horizonHours: outcome.horizonHours,
          outcome: clone(outcome),
        } satisfies StoredOpportunityOutcome);
        request.onerror = (event): void => {
          if (request.error?.name === 'ConstraintError') {
            event.preventDefault();
            return;
          }
          failure = storageError();
          transaction.abort();
        };
      };
    };
  });
}

export function createOpportunityJournal(options: { indexedDB?: IDBFactory } = {}): OpportunityJournal {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  let database: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  let closed = false;

  const open = async (): Promise<IDBDatabase> => {
    if (closed || typeof factory?.open !== 'function') throw storageError();
    if (database) return database;
    if (!opening) {
      opening = openDatabase(factory).then((opened) => {
        if (closed) {
          opened.close();
          throw storageError();
        }
        database = opened;
        opened.onversionchange = (): void => {
          opened.close();
          database = null;
          closed = true;
        };
        return opened;
      }).catch(() => {
        opening = null;
        throw storageError();
      });
    }
    return opening;
  };

  return {
    async list(profileId: string): Promise<OpportunityObservation[]> {
      if (!validProfileId(profileId)) throw storageError();
      const values = await readAll(await open());
      const records = values.map(validateRecord).filter((record) => record.profileId === profileId);
      return sortObservations(records.map((record) => clone(record)));
    },
    async add(record: OpportunityObservation): Promise<void> {
      const valid = validateRecord(record);
      await addRecord(await open(), valid);
    },
    async getOutcome(recordId: string, horizonHours: 6 | 24): Promise<OpportunityOutcome | null> {
      if (!validString(recordId, 128) || !validHorizon(horizonHours)) throw storageError();
      return readOutcome(await open(), recordId, horizonHours);
    },
    async saveOutcome(recordId: string, outcome: OpportunityOutcome): Promise<void> {
      if (!validString(recordId, 128)) throw storageError();
      const valid = validateOutcome(outcome);
      await saveOutcomeRecord(await open(), recordId, valid);
    },
    close(): void {
      closed = true;
      database?.close();
      database = null;
      opening = null;
    },
  };
}

function emptyOutcome(state: 'pending' | 'missing', horizonHours: 6 | 24): OpportunityOutcome {
  return {
    state,
    horizonHours,
    observedAt: null,
    candidateProfit: null,
    baselineProfit: null,
    extraProfit: null,
    maxRelativeShortfall: null,
  };
}

function orderedSnapshots(snapshots: readonly Snapshot[]): Snapshot[] {
  const byTimestamp = new Map<number, Snapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot || !validDate(snapshot.timestamp)) continue;
    byTimestamp.set(snapshot.timestamp, snapshot);
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function evaluateAt(
  candidate: StrategyCandidate,
  baseline: StrategyCandidate,
  snapshots: readonly Snapshot[],
  data: NormalizedStrategyGameData,
  plannedHours: number,
): { candidateProfit: number; baselineProfit: number } | null {
  try {
    const latest = snapshots.at(-1);
    if (!latest) return null;
    const prices = createStrategyPriceBook(latest, data);
    const repricedCandidate = repriceFixedCandidate(candidate, prices);
    const repricedBaseline = repriceFixedCandidate(baseline, prices);
    if (!repricedCandidate || !repricedBaseline) return null;
    const candidateLiquidity = evaluateRealizableStrategy(repricedCandidate, snapshots);
    const baselineLiquidity = evaluateRealizableStrategy(repricedBaseline, snapshots);
    const profile = { materialInventoryMap: {} } as PlayerProfile;
    const candidateSession = estimateStrategySession({
      candidate: repricedCandidate,
      liquidity: candidateLiquidity,
      profile,
      plannedHours,
      latestSnapshotAgeMs: 0,
    });
    const baselineSession = estimateStrategySession({
      candidate: repricedBaseline,
      liquidity: baselineLiquidity,
      profile,
      plannedHours,
      latestSnapshotAgeMs: 0,
    });
    if (
      INVALID_OUTCOME_RISK_CODES.has(candidateLiquidity.riskCode)
      || INVALID_OUTCOME_RISK_CODES.has(baselineLiquidity.riskCode)
      || candidateLiquidity.safeHoursPerDay === null
      || baselineLiquidity.safeHoursPerDay === null
      || candidateLiquidity.safeHoursPerDay <= 0
      || baselineLiquidity.safeHoursPerDay <= 0
      || candidateSession.batchProfit === null
      || baselineSession.batchProfit === null
      || !Number.isFinite(candidateSession.batchProfit)
      || !Number.isFinite(baselineSession.batchProfit)
    ) return null;
    return {
      candidateProfit: candidateSession.batchProfit,
      baselineProfit: baselineSession.batchProfit,
    };
  } catch {
    return null;
  }
}

export function evaluateOpportunityOutcome(
  record: OpportunityObservation,
  snapshots: readonly Snapshot[],
  data: NormalizedStrategyGameData,
  horizonHours: 6 | 24,
): OpportunityOutcome {
  const valid = validateRecord(record);
  if (horizonHours !== 6 && horizonHours !== 24) throw storageError();
  const ordered = orderedSnapshots(snapshots);
  const target = valid.issuedAt + horizonHours * HOUR_MS;
  if (!validDate(target)) throw storageError();
  const observation = ordered.find((snapshot) => (
    snapshot.timestamp >= target && snapshot.timestamp <= target + HOUR_MS
  ));
  if (!observation) {
    return ordered.at(-1)?.timestamp !== undefined && ordered.at(-1)!.timestamp >= target + HOUR_MS
      ? emptyOutcome('missing', horizonHours)
      : emptyOutcome('pending', horizonHours);
  }

  const prefix = ordered.filter((snapshot) => snapshot.timestamp <= observation.timestamp);
  const observed = evaluateAt(valid.candidate, valid.baseline, prefix, data, valid.plannedHours);
  if (!observed) return emptyOutcome('missing', horizonHours);

  let maxRelativeShortfall = 0;
  for (const snapshot of prefix) {
    if (snapshot.timestamp < valid.issuedAt || snapshot.timestamp > observation.timestamp) continue;
    const sample = evaluateAt(
      valid.candidate,
      valid.baseline,
      prefix.filter((item) => item.timestamp <= snapshot.timestamp),
      data,
      valid.plannedHours,
    );
    if (!sample) continue;
    maxRelativeShortfall = Math.max(maxRelativeShortfall, sample.baselineProfit - sample.candidateProfit);
  }

  return {
    state: 'evaluated',
    horizonHours,
    observedAt: observation.timestamp,
    candidateProfit: observed.candidateProfit,
    baselineProfit: observed.baselineProfit,
    extraProfit: observed.candidateProfit - observed.baselineProfit,
    maxRelativeShortfall: Math.max(0, maxRelativeShortfall),
  };
}
