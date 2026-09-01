import type { Quote, Snapshot } from './types';

export const STORAGE_CODEC_PREFIX = 'mwi-radar:gzip-json:v1:';
export const STORAGE_CODEC_GZIP_PREFIX = STORAGE_CODEC_PREFIX;
export const DEFAULT_MAX_DECODED_BYTES = 64 * 1024 * 1024;

export type StorageDecodeReason = 'prefix' | 'base64' | 'gzip' | 'json' | 'schema' | 'size' | 'cancelled' | 'unsupported';

export class StorageDecodeError extends Error {
  readonly reason: StorageDecodeReason;

  constructor(reason: StorageDecodeReason, message: string) {
    super(message);
    this.name = 'StorageDecodeError';
    this.reason = reason;
  }
}

function unsupported(message: string): StorageDecodeError {
  return new StorageDecodeError('unsupported', `Storage codec unsupported: ${message}`);
}

function requireCompressionStream(): typeof CompressionStream {
  if (typeof globalThis.CompressionStream !== 'function') {
    throw unsupported('CompressionStream is unavailable.');
  }

  return globalThis.CompressionStream;
}

function requireDecompressionStream(): typeof DecompressionStream {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw unsupported('DecompressionStream is unavailable.');
  }

  return globalThis.DecompressionStream;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  if (typeof globalThis.btoa !== 'function') {
    throw unsupported('base64 encoding is unavailable.');
  }

  return globalThis.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new StorageDecodeError('base64', 'Storage day chunk contains invalid base64.');
  }

  if (typeof globalThis.atob !== 'function') {
    throw unsupported('base64 decoding is unavailable.');
  }

  let decoded: string;
  try {
    decoded = globalThis.atob(value);
  } catch {
    throw new StorageDecodeError('base64', 'Storage day chunk contains invalid base64.');
  }

  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidQuoteValue(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isQuote(value: unknown): value is Quote {
  if (!isRecord(value)) return false;

  return (
    Object.prototype.hasOwnProperty.call(value, 'a') &&
    Object.prototype.hasOwnProperty.call(value, 'b') &&
    Object.prototype.hasOwnProperty.call(value, 'p') &&
    Object.prototype.hasOwnProperty.call(value, 'v') &&
    isValidQuoteValue(value.a) &&
    isValidQuoteValue(value.b) &&
    isValidQuoteValue(value.p) &&
    isValidQuoteValue(value.v)
  );
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;

  const timestamp = value.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || !Number.isInteger(timestamp) || timestamp < 0) {
    return false;
  }
  if (!isRecord(value.quotes)) return false;

  for (const quote of Object.values(value.quotes)) {
    if (!isQuote(quote)) return false;
  }
  return true;
}

function isSnapshotArray(value: unknown): value is Snapshot[] {
  return Array.isArray(value) && value.every(isSnapshot);
}

export async function encodeDayChunk(value: Snapshot[]): Promise<string> {
  const CompressionStreamConstructor = requireCompressionStream();
  const json = JSON.stringify(value);
  const stream = new Blob([new TextEncoder().encode(json)])
    .stream()
    .pipeThrough(new CompressionStreamConstructor('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return `${STORAGE_CODEC_PREFIX}${bytesToBase64(bytes)}`;
}

export async function decodeDayChunkLimited(
  value: string,
  maxDecodedBytes: number,
  signal?: AbortSignal,
): Promise<Snapshot[]> {
  if (typeof value !== 'string' || !value.startsWith(STORAGE_CODEC_PREFIX)) {
    throw new StorageDecodeError('prefix', 'Storage day chunk has an unsupported codec prefix.');
  }
  if (signal?.aborted) {
    throw new StorageDecodeError('cancelled', 'Storage day chunk decode was cancelled.');
  }
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0) {
    throw new StorageDecodeError('size', 'Storage day chunk exceeds the decoded size limit.');
  }

  const encodedBytes = base64ToBytes(value.slice(STORAGE_CODEC_PREFIX.length));
  const DecompressionStreamConstructor = requireDecompressionStream();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const stream = new Blob([encodedBytes.buffer as ArrayBuffer])
      .stream()
      .pipeThrough(new DecompressionStreamConstructor('gzip'));
    reader = stream.getReader();
  } catch {
    throw new StorageDecodeError('gzip', 'Storage day chunk could not be decompressed as gzip.');
  }

  const chunks: Uint8Array[] = [];
  let decodedBytes = 0;
  let cancelled = false;
  const cancelReader = (): void => {
    cancelled = true;
    void reader['cancel']().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelReader, { once: true });
  let bytes: Uint8Array;
  try {
    while (true) {
      if (cancelled || signal?.aborted) {
        throw new StorageDecodeError('cancelled', 'Storage day chunk decode was cancelled.');
      }
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        if (cancelled || signal?.aborted) {
          throw new StorageDecodeError('cancelled', 'Storage day chunk decode was cancelled.');
        }
        throw new StorageDecodeError('gzip', 'Storage day chunk could not be decompressed as gzip.');
      }
      if (cancelled || signal?.aborted) {
        throw new StorageDecodeError('cancelled', 'Storage day chunk decode was cancelled.');
      }
      if (result.done) break;
      const chunk = result.value;
      decodedBytes += chunk.byteLength;
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes > maxDecodedBytes) {
        cancelReader();
        throw new StorageDecodeError('size', 'Storage day chunk exceeds the decoded size limit.');
      }
      chunks.push(chunk);
    }

    bytes = new Uint8Array(decodedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }

  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StorageDecodeError('json', 'Storage day chunk contains invalid JSON.');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new StorageDecodeError('json', 'Storage day chunk contains invalid JSON.');
  }

  if (!isSnapshotArray(decoded)) {
    throw new StorageDecodeError('schema', 'Storage day chunk does not match the snapshot schema.');
  }

  return decoded;
}

export async function decodeDayChunk(value: string): Promise<Snapshot[]> {
  return decodeDayChunkLimited(value, DEFAULT_MAX_DECODED_BYTES);
}
