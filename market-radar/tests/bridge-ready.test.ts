// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForBridgeReady } from '../src/dashboard/client';

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForBridgeReady', () => {
  it('resolves immediately when the shared DOM target is already ready', async () => {
    const target = document.createElement('div');
    target.dataset.mwiRadarBridge = 'ready';

    await expect(waitForBridgeReady(target)).resolves.toBe(true);
  });

  it('observes a late bridge marker without delaying beyond the ready mutation', async () => {
    const target = document.createElement('div');
    const waiting = waitForBridgeReady(target, { timeoutMs: 2_500 });
    target.dataset.mwiRadarBridge = 'ready';

    await expect(waiting).resolves.toBe(true);
  });

  it('resolves false when no bridge marker appears before the bounded timeout', async () => {
    vi.useFakeTimers();
    const target = document.createElement('div');
    const waiting = waitForBridgeReady(target, { timeoutMs: 40 });

    await vi.advanceTimersByTimeAsync(40);
    await expect(waiting).resolves.toBe(false);
  });

  it('resolves false when the waiting owner is aborted', async () => {
    const target = document.createElement('div');
    const controller = new AbortController();
    const waiting = waitForBridgeReady(target, { timeoutMs: 2_500, signal: controller.signal });
    controller.abort();

    await expect(waiting).resolves.toBe(false);
  });
});
