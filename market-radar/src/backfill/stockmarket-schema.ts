import type { Quote } from '../core/types';

export interface StockmarketHistoryPoint extends Quote {
  itemName: string;
  level: number;
  timestamp: number;
}

const SAFE_ITEM_NAME = /^[a-z0-9_]+$/;

function record(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function safeItemName(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ITEM_NAME.test(value);
}

function nonNegativeFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseStockmarketItemNames(value: unknown): string[] {
  const data = record(value, 'Invalid stockmarket data').data;
  if (!Array.isArray(data)) throw new Error('Invalid stockmarket item list');

  const names = data.map((entry) => {
    const item = record(entry, 'Invalid stockmarket item');
    if (!safeItemName(item.item_name)) throw new Error('Invalid stockmarket item name');
    return item.item_name;
  });

  return [...new Set(names)].sort();
}

export function parseStockmarketHistory(value: unknown, expectedItem: string): StockmarketHistoryPoint[] {
  if (!safeItemName(expectedItem)) throw new Error('Invalid stockmarket item name');
  const payload = record(value, 'Invalid stockmarket data');
  if (payload.item !== undefined && payload.item !== expectedItem) {
    throw new Error('Stockmarket item mismatch');
  }
  const history = payload.history;
  if (!Array.isArray(history)) throw new Error('Invalid stockmarket history');

  return history.map((entry) => {
    const row = record(entry, 'Invalid stockmarket history row');
    if (row.item_name !== expectedItem || !safeItemName(row.item_name)) {
      throw new Error('Stockmarket item mismatch');
    }
    if (!Number.isSafeInteger(row.level) || (row.level as number) < 0) {
      throw new Error('Invalid stockmarket level');
    }
    if (!Number.isSafeInteger(row.timestamp) || (row.timestamp as number) < 0) {
      throw new Error('Invalid stockmarket timestamp');
    }

    const timestamp = (row.timestamp as number) * 1_000;
    if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid stockmarket timestamp');

    const a = nonNegativeFinite(row.price_a);
    const b = nonNegativeFinite(row.price_b);
    const p = nonNegativeFinite(row.price_p);
    const volume = nonNegativeFinite(row.volume);
    const hasPriceSentinel = [row.price_a, row.price_b, row.price_p].some(
      (price) => typeof price === 'number' && Number.isFinite(price) && price < 0,
    );

    return {
      itemName: expectedItem,
      level: row.level as number,
      timestamp,
      a,
      b,
      p,
      v: volume === 0 && (hasPriceSentinel || (a === null && b === null && p === null)) ? null : volume,
    };
  });
}
