// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CollectorStatus, Snapshot } from '../src/core/types';
import { StorageWriteError } from '../src/collector/market-store';
import { OfficialMarketError } from '../src/collector/official-client';
import { CollectorLockError } from '../src/collector/lock';
import {
  buildHealthModel,
  detectSnapshotGaps,
  formatTaipeiTime,
  renderBridgeUnavailable,
  renderCollectorStatus,
} from '../src/dashboard/status';
import { classifyCollectorError } from '../src/userscript/game-collector';

const HOUR = 3_600_000;

const status = (overrides: Partial<CollectorStatus> = {}): CollectorStatus => ({
  state: 'ok',
  lastAttemptAt: 3 * HOUR,
  lastSuccessAt: 3 * HOUR,
  officialTimestamp: 3 * HOUR,
  nextRunAt: 4 * HOUR,
  lastErrorCode: null,
  ...overrides,
});

const snapshots = (timestamps: number[]): Snapshot[] => timestamps.map((timestamp) => ({
  timestamp,
  quotes: {},
}));

describe('snapshot health', () => {
  it('sorts/deduplicates snapshots and reports only gaps over 1.75 hours', () => {
    expect(detectSnapshotGaps(snapshots([3 * HOUR, 0, HOUR, HOUR, 4 * HOUR]))).toEqual([
      { from: HOUR, to: 3 * HOUR, hours: 2 },
    ]);
  });

  it('does not invent rows or interpolation for an empty history', () => {
    const health = buildHealthModel(status(), [], 3 * HOUR);

    expect(health.headline).toContain('尚無市場快照');
    expect(health.detail).toContain('保持 MWI 分頁開啟');
    expect(health.gaps).toEqual([]);
  });

  it('shows stale, retrying, and fixed error-code states without raw error details', () => {
    const stale = buildHealthModel(status({ lastSuccessAt: 0 }), snapshots([0, 3 * HOUR]), 3 * HOUR);
    expect(stale.headline).toContain('等待遊戲分頁');

    const retrying = buildHealthModel(
      status({ state: 'retrying', nextRunAt: 4 * HOUR }),
      snapshots([3 * HOUR]),
      3 * HOUR,
    );
    expect(retrying.headline).toContain('重試');
    expect(retrying.detail).toContain(formatTaipeiTime(4 * HOUR));

    for (const code of ['network', 'schema', 'storage', 'lock', 'cancel', 'unknown']) {
      const model = buildHealthModel(
        status({ state: 'error', lastErrorCode: code }),
        snapshots([3 * HOUR]),
        3 * HOUR,
      );
      expect(model.headline).not.toContain(code);
      expect(model.detail).not.toContain('stack');
      if (code === 'storage') expect(model.detail).toContain('保留舊資料');
    }
  });

  it('exposes gap count/ranges and renders only safe text inside the live status region', () => {
    const health = buildHealthModel(status(), snapshots([0, 3 * HOUR]), 3 * HOUR);
    expect(health.gapCount).toBe(1);
    expect(health.gaps[0]).toMatchObject({ from: 0, to: 3 * HOUR, hours: 3 });

    const target = document.createElement('div');
    target.setAttribute('aria-live', 'polite');
    renderCollectorStatus(target, status(), 'private stack/body', health);
    expect(target.textContent).toContain('資料缺口');
    expect(target.textContent).not.toContain('private stack/body');
    expect(target.getAttribute('aria-live')).toBe('polite');

    renderBridgeUnavailable(target, 'private bridge stack');
    expect(target.textContent).not.toContain('private bridge stack');
  });
});

describe('collector error classification', () => {
  it('maps network/schema/storage/lock/cancel and unknown failures to stable codes', () => {
    expect(classifyCollectorError(new OfficialMarketError('timeout', 'Official marketplace request timed out'))).toBe('network');
    expect(classifyCollectorError(new SyntaxError('invalid JSON body'))).toBe('schema');
    const storageError = new StorageWriteError('private-key');
    storageError.name = 'TypeError';
    expect(classifyCollectorError(storageError)).toBe('storage');
    expect(classifyCollectorError(new CollectorLockError('unavailable'))).toBe('lock');
    expect(classifyCollectorError(new OfficialMarketError('cancelled', 'Official marketplace request cancelled'))).toBe('cancel');
    expect(classifyCollectorError(new Error('private unexpected body'))).toBe('unknown');
  });
});
