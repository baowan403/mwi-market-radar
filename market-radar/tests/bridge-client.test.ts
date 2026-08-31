// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeBootstrap,
  BridgeResponse,
  CollectorStatus,
  RadarSettings,
  Snapshot,
  WatchItem,
} from '../src/core/types';
import {
  BRIDGE_REQUEST_EVENT,
  BRIDGE_RESPONSE_EVENT,
  BridgeError,
  createDashboardClient,
} from '../src/dashboard/client';

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
    timestamp: 900,
    quotes: { '/items/test::0': { a: 101, b: 99, p: 100, v: 2 } },
  },
];

function requestDetail(event: Event): Record<string, unknown> {
  return (event as CustomEvent<Record<string, unknown>>).detail;
}

function respond(target: EventTarget, response: BridgeResponse): void {
  target.dispatchEvent(new CustomEvent(BRIDGE_RESPONSE_EVENT, { detail: response }));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createDashboardClient', () => {
  it('round-trips typed bootstrap and emits the exact request detail', async () => {
    const target = new EventTarget();
    target.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
      expect(requestDetail(event)).toEqual({ id: 'request-1', type: 'bootstrap' });
      respond(target, { id: 'request-1', ok: true, value: bootstrap });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1' });

    await expect(client.bootstrap()).resolves.toEqual(bootstrap);
    expect(client).not.toHaveProperty('request');
  });

  it('reads snapshots and sends only the four allowlisted request shapes', async () => {
    const target = new EventTarget();
    const details: Record<string, unknown>[] = [];
    let nextResponse: unknown = snapshots;
    target.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
      const detail = requestDetail(event);
      details.push(detail);
      respond(target, { id: String(detail.id), ok: true, value: nextResponse });
    });
    let nextId = 0;
    const client = createDashboardClient(target, { idFactory: () => `request-${++nextId}` });
    const watchlist: WatchItem[] = [{ key: '/items/test::7', order: 0 }];

    await expect(client.listSnapshots()).resolves.toEqual(snapshots);
    nextResponse = { acknowledged: true };
    await expect(client.setWatchlist(watchlist)).resolves.toBeUndefined();
    await expect(client.setSettings(settings)).resolves.toBeUndefined();

    expect(details).toEqual([
      { id: 'request-1', type: 'snapshots' },
      { id: 'request-2', type: 'set-watchlist', value: watchlist },
      { id: 'request-3', type: 'set-settings', value: settings },
    ]);
  });

  it('ignores mismatched and malformed responses until a matching well-formed response arrives', async () => {
    const target = new EventTarget();
    target.addEventListener(BRIDGE_REQUEST_EVENT, () => {
      respond(target, { id: 'other-request', ok: true, value: bootstrap });
      respond(target, { id: 'request-1', ok: true } as BridgeResponse);
      respond(target, { id: 'request-1', ok: true, value: bootstrap });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1' });

    await expect(client.bootstrap()).resolves.toEqual(bootstrap);
  });

  it('correlates concurrent requests when responses arrive out of order', async () => {
    const target = new EventTarget();
    const pending: Record<string, string>[] = [];
    target.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
      pending.push(requestDetail(event) as Record<string, string>);
    });
    const client = createDashboardClient(target, {
      idFactory: (() => {
        let nextId = 0;
        return () => `request-${++nextId}`;
      })(),
    });

    const bootstrapRequest = client.bootstrap();
    const snapshotsRequest = client.listSnapshots();
    await Promise.resolve();
    expect(pending.map((request) => request.id)).toEqual(['request-1', 'request-2']);

    respond(target, { id: 'request-2', ok: true, value: snapshots });
    respond(target, { id: 'request-1', ok: true, value: bootstrap });

    await expect(snapshotsRequest).resolves.toEqual(snapshots);
    await expect(bootstrapRequest).resolves.toEqual(bootstrap);
  });

  it('throws a safe BridgeError for a matching error response', async () => {
    const target = new EventTarget();
    target.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
      respond(target, {
        id: String(requestDetail(event).id),
        ok: false,
        error: { code: 'storage', message: 'Market data unavailable' },
      });
    });
    const client = createDashboardClient(target, { idFactory: () => 'request-1' });

    const error = await client.bootstrap().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BridgeError);
    expect(error).toMatchObject({ code: 'storage', message: 'Market data unavailable' });
  });

  it('times out and cleans the response listener and timer', async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const removeEventListener = vi.spyOn(target, 'removeEventListener');
    const client = createDashboardClient(target, { timeoutMs: 25, idFactory: () => 'request-1' });
    const pending = client.listSnapshots();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses crypto.randomUUID by default and a timestamp-random fallback when unavailable', async () => {
    const target = new EventTarget();
    const randomUUID = vi.fn(() => 'uuid-1');
    vi.stubGlobal('crypto', { randomUUID });
    let observedId = '';
    target.addEventListener(BRIDGE_REQUEST_EVENT, (event) => {
      observedId = String(requestDetail(event).id);
      respond(target, { id: observedId, ok: true, value: bootstrap });
    });

    await createDashboardClient(target).bootstrap();
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(observedId).toBe('uuid-1');
  });
});
