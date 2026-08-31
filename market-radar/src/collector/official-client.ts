import { parseOfficialSnapshot } from '../core/market-schema';
import type { Snapshot } from '../core/types';

export const OFFICIAL_MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';

export interface OfficialSnapshotClientOptions {
  fetcher?: typeof fetch;
  now?: () => number;
}

function isFetcher(value: typeof fetch | OfficialSnapshotClientOptions): value is typeof fetch {
  return typeof value === 'function';
}

/** Fetch and validate one public marketplace snapshot without sending credentials. */
export async function fetchOfficialSnapshot(
  optionsOrFetcher: OfficialSnapshotClientOptions | typeof fetch = {},
  now?: () => number,
): Promise<Snapshot> {
  const fetcher = isFetcher(optionsOrFetcher)
    ? optionsOrFetcher
    : optionsOrFetcher.fetcher ?? globalThis.fetch;
  const clock = now ?? (isFetcher(optionsOrFetcher) ? undefined : optionsOrFetcher.now) ?? (() => Date.now());
  const url = `${OFFICIAL_MARKETPLACE_URL}?radar=${clock()}`;
  const response = await fetcher(url, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error(`Official marketplace request failed: ${response.status}`);
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error('Official marketplace response JSON parse failed');
  }

  return parseOfficialSnapshot(raw);
}
