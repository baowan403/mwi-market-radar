import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Snapshot } from '../src/core/types';
import { decodeDayChunk } from '../src/core/storage-codec';
import { parseOfficialSnapshot } from '../src/core/market-schema';
import { parseManifest } from '../src/cloud/manifest';
import { updateCloudHistory } from '../src/cloud/history-store';
import type { CloudManifest } from '../src/cloud/types';

export const OFFICIAL_MARKETPLACE_URL = 'https://www.milkywayidle.com/game_data/marketplace.json';
export const DEFAULT_CLOUD_DATA_DIR = 'cloud-data';
export const DEFAULT_MIN_QUOTES = 1_000;

export type CloudCliErrorCode =
  | 'args'
  | 'unsafe_source'
  | 'network'
  | 'schema'
  | 'minimum_quotes'
  | 'validation'
  | 'storage';

export class CloudCliError extends Error {
  readonly code: CloudCliErrorCode;

  constructor(code: CloudCliErrorCode, message: string) {
    super(message);
    this.name = 'CloudCliError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface CloudCliArgs {
  dataDir: string;
  sourceUrl: string;
  fixture: string | null;
  minQuotes: number;
  validateOnly: boolean;
}

export interface CloudCliDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

const SAFE_ERROR_MESSAGES: Record<CloudCliErrorCode, string> = {
  args: 'Invalid cloud history arguments',
  unsafe_source: 'Source URL must use HTTPS without credentials',
  network: 'Official market request failed',
  schema: 'Market snapshot data is invalid',
  minimum_quotes: 'Market snapshot has too few quotes',
  validation: 'Cloud history validation failed',
  storage: 'Cloud history storage failed',
};

function isNodeError(value: unknown, code: string): boolean {
  return value !== null
    && typeof value === 'object'
    && (value as { code?: unknown }).code === code;
}

function argumentValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith('--')) {
    throw new CloudCliError('args', `Missing value for ${flag}`);
  }
  return value;
}

function validateSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CloudCliError('unsafe_source', SAFE_ERROR_MESSAGES.unsafe_source);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new CloudCliError('unsafe_source', SAFE_ERROR_MESSAGES.unsafe_source);
  }
  return value;
}

function parseMinimumQuotes(value: string): number {
  if (!/^\d+$/.test(value)) throw new CloudCliError('args', 'Invalid minimum quote count');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CloudCliError('args', 'Invalid minimum quote count');
  }
  return parsed;
}

/** Parse only the documented long options. */
export function parseArgs(argv: readonly string[]): CloudCliArgs {
  let dataDir = DEFAULT_CLOUD_DATA_DIR;
  let sourceUrl = OFFICIAL_MARKETPLACE_URL;
  let fixture: string | null = null;
  let minQuotes = DEFAULT_MIN_QUOTES;
  let validateOnly = false;
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--data-dir') {
      if (seen.has(flag)) throw new CloudCliError('args', 'Duplicate cloud history argument');
      seen.add(flag);
      dataDir = argumentValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === '--source-url') {
      if (seen.has(flag)) throw new CloudCliError('args', 'Duplicate cloud history argument');
      seen.add(flag);
      sourceUrl = validateSourceUrl(argumentValue(argv, index, flag));
      index += 1;
      continue;
    }
    if (flag === '--fixture') {
      if (seen.has(flag)) throw new CloudCliError('args', 'Duplicate cloud history argument');
      seen.add(flag);
      fixture = argumentValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === '--min-quotes') {
      if (seen.has(flag)) throw new CloudCliError('args', 'Duplicate cloud history argument');
      seen.add(flag);
      minQuotes = parseMinimumQuotes(argumentValue(argv, index, flag));
      index += 1;
      continue;
    }
    if (flag === '--validate-only') {
      if (seen.has(flag)) throw new CloudCliError('args', 'Duplicate cloud history argument');
      seen.add(flag);
      validateOnly = true;
      continue;
    }
    throw new CloudCliError('args', 'Unknown cloud history argument');
  }

  if (dataDir.length === 0) throw new CloudCliError('args', 'Invalid cloud data directory');
  return { dataDir, sourceUrl, fixture, minQuotes, validateOnly };
}

async function readFixture(path: string): Promise<Snapshot> {
  let text: string;
  try {
    text = await readFile(resolve(path), 'utf8');
  } catch {
    throw new CloudCliError('storage', SAFE_ERROR_MESSAGES.storage);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new CloudCliError('schema', SAFE_ERROR_MESSAGES.schema);
  }
  try {
    return parseOfficialSnapshot(raw);
  } catch {
    throw new CloudCliError('schema', SAFE_ERROR_MESSAGES.schema);
  }
}

async function fetchSnapshot(sourceUrl: string, fetcher: typeof fetch): Promise<Snapshot> {
  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new CloudCliError('network', SAFE_ERROR_MESSAGES.network);
  }
  if (!response.ok) throw new CloudCliError('network', SAFE_ERROR_MESSAGES.network);

  let raw: unknown;
  try {
    raw = await response.json() as unknown;
  } catch {
    throw new CloudCliError('schema', SAFE_ERROR_MESSAGES.schema);
  }
  try {
    return parseOfficialSnapshot(raw);
  } catch {
    throw new CloudCliError('schema', SAFE_ERROR_MESSAGES.schema);
  }
}

function entryPath(dataDir: string, file: string): string {
  const [directory, basename] = file.split('/');
  if (directory !== 'snapshots' || basename === undefined) {
    throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
  }
  return join(dataDir, directory, basename);
}

async function readManifestFile(dataDir: string): Promise<CloudManifest> {
  let text: string;
  try {
    text = await readFile(join(dataDir, 'manifest.json'), 'utf8');
  } catch {
    throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
  }
  try {
    return parseManifest(JSON.parse(text) as unknown);
  } catch {
    throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
  }
}

async function validateCloudHistory(dataDir: string): Promise<CloudManifest> {
  const manifest = await readManifestFile(dataDir);
  for (const entry of manifest.snapshots) {
    let text: string;
    try {
      text = await readFile(entryPath(dataDir, entry.file), 'utf8');
    } catch {
      throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
    }
    if (Buffer.byteLength(text, 'utf8') !== entry.bytes) {
      throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
    }
    let snapshots: Snapshot[];
    try {
      snapshots = await decodeDayChunk(text);
    } catch {
      throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
    }
    if (snapshots.length !== 1 || snapshots[0]?.timestamp !== entry.timestamp) {
      throw new CloudCliError('validation', SAFE_ERROR_MESSAGES.validation);
    }
  }
  return manifest;
}

/** Run the cloud updater and return a process-style exit code. */
export async function run(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CloudCliDependencies = {},
): Promise<number> {
  try {
    const args = parseArgs(argv);
    const dataDir = resolve(args.dataDir);
    if (args.validateOnly) {
      await validateCloudHistory(dataDir);
      console.log('Cloud history valid');
      return 0;
    }

    const snapshot = args.fixture === null
      ? await fetchSnapshot(args.sourceUrl, dependencies.fetch ?? globalThis.fetch)
      : await readFixture(args.fixture);
    if (Object.keys(snapshot.quotes).length < args.minQuotes) {
      throw new CloudCliError('minimum_quotes', SAFE_ERROR_MESSAGES.minimum_quotes);
    }
    const now = dependencies.now ?? (() => Date.now());
    const result = await updateCloudHistory({
      dataDir,
      snapshot,
      generatedAt: new Date(now()).toISOString(),
    });
    console.log(result.inserted ? 'Cloud history updated' : 'Cloud history unchanged');
    if (result.cleanupErrors.length > 0) {
      console.error('Cloud history cleanup incomplete');
      return 1;
    }
    return 0;
  } catch (cause) {
    const code = cause instanceof CloudCliError
      ? cause.code
      : cause !== null && typeof cause === 'object' && 'code' in cause && (cause as { code?: unknown }).code === 'older_snapshot'
        ? 'storage'
        : 'storage';
    console.error(SAFE_ERROR_MESSAGES[code]);
    return 1;
  }
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = 1;
  });
}
