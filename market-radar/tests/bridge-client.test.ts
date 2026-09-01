// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeBootstrap,
  BridgeResponse,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  SnapshotPage,
  WatchItem,
} from '../src/core/types';
import {
  BRIDGE_REQUEST_PREFIX,
  BRIDGE_RESPONSE_PREFIX,
  BridgeError,
  createDashboardClient,
} from '../src/dashboard/client';

const TEST_ORIGIN = 'https://example.test';

class MessageTarget extends EventTarget {
  postMessage(message: unknown, targetOrigin: string): void {
    if (targetOrigin !== TEST_ORIGIN) throw new Error(`unexpected target origin: ${targetOrigin}`);
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data: message, origin: TEST_ORIGIN }));
    });
  }
}

const settings: RadarSettings = {
  period: '1d',
  minimumVolume: 1,
  maximumSpreadPct: 10,
  anomalyMovePct: 5,
  anomalyVolumeMultiple: 2,
};

const collectorStatus: CollectorStatus = {
  state: 'ok',
  lastAttemptAt: 1_000,
  lastSuccessAt: 1_000,
  officialTimestamp: 900,
  nextRunAt: 2_000,
  lastErrorCode: null,
};

const bootstrap: BridgeBootstrap = {
  watchlist: [{ key: '/items/test::0', order: 0 }],
  settings,
  collectorStatus,
  latestTimestamp: 900,
  snapshotCount: 3,
};

const snapshots: Snapshot[] = [
  {
    timestamp: 100,
    quotes: { '/items/test::0': { a: 101, b: 99, p: 100, v: 2 } },
  },
  {
    timestamp: 200,
    quotes: { '/items/test::0': { a: 111, b: 109, p: 110, v: 3 } },
  },
  {
    timestamp: 300,
    quotes: { '/items/test::0': { a: 121, b: 119, p: 120, v: 4 } },
  },
];

function wireData(event: Event): string {
  const data = (event as MessageEvent<unknown>).data;
  expect(event.type).toBe('message');
  expect((event as MessageEvent).origin).toBe(TEST_ORIGIN);
  expect(typeof data).toBe('string');
  return data as string;
}

function requestDetail(event: Event): Record<string, unknown> {
  const data = wireData(event);
  expect(data.startsWith(BRIDGE_REQUEST_PREFIX)).toBe(true);
  return JSON.parse(data.slice(BRIDGE_REQUEST_PREFIX.length)) as Record<string, unknown>;
}

function emitMessage(target: EventTarget, data: unknown, origin = TEST_ORIGIN): void {
  target.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function respond(target: EventTarget, response: BridgeResponse): void {
  emitMessage(target, `${BRIDGE_RESPONSE_PREFIX}${JSON.stringify(response)}`);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createDashboardClient', () => {
  it('round-trips typed bootstrap over a JSON-string wire with exact request detail', async () => {
    const target = new MessageTarget();
    target.addEventListener('message', (event) => {
      expect(requestDetail(event)).toEqual({ id: 'request-1', type: 'bootstrap' });
      respond(target, { id: 'request-1', ok: true, value: bootstrap });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1', targetOrigin: TEST_ORIGIN });

    await expect(client.bootstrap()).resolves.toEqual(bootstrap);
    expect(client).not.toHaveProperty('request');
  });

  it('pages snapshots newest-first, deduplicates timestamps, and returns ascending results', async () => {
    const target = new MessageTarget();
    const details: Record<string, unknown>[] = [];
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      const detail = requestDetail(event);
      details.push(detail);
      const page: SnapshotPage = detail.beforeTimestamp === null
        ? { items: [snapshots[2]!, snapshots[1]!], nextBeforeTimestamp: 200, hasMore: true }
        : { items: [snapshots[1]!, snapshots[0]!], nextBeforeTimestamp: null, hasMore: false };
      respond(target, { id: String(detail.id), ok: true, value: page });
    });
    const client = createDashboardClient(target, {
      idFactory: (() => {
        let nextId = 0;
        return () => `request-${++nextId}`;
      })(),
      snapshotPageSize: 2,
      targetOrigin: TEST_ORIGIN,
    });

    await expect(client.listSnapshots()).resolves.toEqual(snapshots);
    expect(details).toEqual([
      { id: 'request-1', type: 'snapshots', beforeTimestamp: null, limit: 2 },
      { id: 'request-2', type: 'snapshots', beforeTimestamp: 200, limit: 2 },
    ]);
  });

  it('sends only the four allowlisted request shapes and setter methods resolve void', async () => {
    const target = new MessageTarget();
    const details: Record<string, unknown>[] = [];
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      const detail = requestDetail(event);
      details.push(detail);
      const value = detail.type === 'snapshots'
        ? { items: [], nextBeforeTimestamp: null, hasMore: false }
        : { acknowledged: true };
      respond(target, { id: String(detail.id), ok: true, value });
    });
    let nextId = 0;
    const client = createDashboardClient(target, {
      idFactory: () => `request-${++nextId}`,
      targetOrigin: TEST_ORIGIN,
    });
    const watchlist: WatchItem[] = [{ key: '/items/test::7', order: 0 }];

    await client.listSnapshots();
    await expect(client.setWatchlist(watchlist)).resolves.toBeUndefined();
    await expect(client.setSettings(settings)).resolves.toBeUndefined();

    expect(details).toEqual([
      { id: 'request-1', type: 'snapshots', beforeTimestamp: null, limit: 12 },
      { id: 'request-2', type: 'set-watchlist', value: watchlist },
      { id: 'request-3', type: 'set-settings', value: settings },
    ]);
  });

  it('ignores mismatched, malformed, and non-string responses until a valid match arrives', async () => {
    const target = new MessageTarget();
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      respond(target, { id: 'other-request', ok: true, value: bootstrap });
      emitMessage(target, { id: 'request-1', ok: true, value: bootstrap });
      emitMessage(target, `${BRIDGE_RESPONSE_PREFIX}{"id":"request-1","ok":true}`);
      respond(target, { id: 'request-1', ok: true, value: bootstrap });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1', targetOrigin: TEST_ORIGIN });

    await expect(client.bootstrap()).resolves.toEqual(bootstrap);
  });

  it('ignores foreign-origin messages and request-channel echoes', async () => {
    const target = new MessageTarget();
    const client = createDashboardClient(target, { idFactory: () => 'request-1', targetOrigin: TEST_ORIGIN });
    const pending = client.bootstrap();

    await Promise.resolve();
    emitMessage(target, `${BRIDGE_RESPONSE_PREFIX}${JSON.stringify({
      id: 'request-1',
      ok: true,
      value: bootstrap,
    })}`, 'https://foreign.example');
    emitMessage(target, `${BRIDGE_REQUEST_PREFIX}${JSON.stringify({ id: 'request-1', type: 'bootstrap' })}`);
    emitMessage(target, `${BRIDGE_RESPONSE_PREFIX}${JSON.stringify({
      id: 'request-1',
      ok: true,
      value: bootstrap,
    })}`);

    await expect(pending).resolves.toEqual(bootstrap);
  });

  it('correlates concurrent requests when JSON responses arrive out of order', async () => {
    const target = new MessageTarget();
    const pending: Record<string, unknown>[] = [];
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      pending.push(requestDetail(event));
    });
    const client = createDashboardClient(target, {
      idFactory: (() => {
        let nextId = 0;
        return () => `request-${++nextId}`;
      })(),
      targetOrigin: TEST_ORIGIN,
    });

    const bootstrapRequest = client.bootstrap();
    const snapshotsRequest = client.listSnapshots();
    await Promise.resolve();
    expect(pending.map((request) => request.id)).toEqual(['request-1', 'request-2']);

    respond(target, {
      id: 'request-2',
      ok: true,
      value: { items: [], nextBeforeTimestamp: null, hasMore: false },
    });
    respond(target, { id: 'request-1', ok: true, value: bootstrap });

    await expect(snapshotsRequest).resolves.toEqual([]);
    await expect(bootstrapRequest).resolves.toEqual(bootstrap);
  });

  it('throws a safe BridgeError for a matching JSON error response', async () => {
    const target = new MessageTarget();
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      respond(target, {
        id: String(requestDetail(event).id),
        ok: false,
        error: { code: 'storage_error', message: 'Market data storage unavailable' },
      });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1', targetOrigin: TEST_ORIGIN });

    const error = await client.bootstrap().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code: 'storage_error', message: 'Market data storage unavailable' });
  });

  it('rejects invalid setters locally as invalid_request without dispatching', async () => {
    const target = new MessageTarget();
    const requests = vi.fn();
    target.addEventListener('message', requests);
    const client = createDashboardClient(target, { idFactory: () => 'request-1', targetOrigin: TEST_ORIGIN });

    await expect(client.setWatchlist(null as unknown as WatchItem[])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(client.setSettings(null as unknown as RadarSettings)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(requests).not.toHaveBeenCalled();
  });

  it('times out and cleans the response listener and timer', async () => {
    vi.useFakeTimers();
    const target = new MessageTarget();
    const removeEventListener = vi.spyOn(target, 'removeEventListener');
    const client = createDashboardClient(target, {
      timeoutMs: 25,
      idFactory: () => 'request-1',
      targetOrigin: TEST_ORIGIN,
    });
    const pending = client.bootstrap();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases settled ids so a later request can reuse an id without unbounded history', async () => {
    const target = new MessageTarget();
    const ids: string[] = [];
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      const detail = requestDetail(event);
      ids.push(String(detail.id));
      const value = detail.type === 'bootstrap'
        ? bootstrap
        : { items: [], nextBeforeTimestamp: null, hasMore: false };
      respond(target, { id: String(detail.id), ok: true, value });
    });
    const client = createDashboardClient(target, { idFactory: () => 'same-id', targetOrigin: TEST_ORIGIN });

    await client.bootstrap();
    await client.listSnapshots();
    expect(ids).toEqual(['same-id', 'same-id']);
  });

  it('uses crypto.randomUUID by default and a timestamp-random fallback when unavailable', async () => {
    const target = new MessageTarget();
    const randomUUID = vi.fn(() => 'uuid-1');
    vi.stubGlobal('crypto', { randomUUID });
    let observedId = '';
    target.addEventListener('message', (event) => {
      if (!(event as MessageEvent).data.startsWith(BRIDGE_REQUEST_PREFIX)) return;
      observedId = String(requestDetail(event).id);
      respond(target, { id: observedId, ok: true, value: bootstrap });
    });

    await createDashboardClient(target, { targetOrigin: TEST_ORIGIN }).bootstrap();
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(observedId).toBe('uuid-1');
  });
});
