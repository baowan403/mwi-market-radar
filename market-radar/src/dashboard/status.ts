import type { CollectorStatus, Snapshot } from '../core/types';
import { CLOUD_RETENTION_MS } from '../cloud/types';

const STATE_LABELS: Record<CollectorStatus['state'], string> = {
  idle: '待機',
  checking: '採集中',
  retrying: '重試中',
  ok: '正常',
  error: '錯誤',
};

export const NO_BRIDGE_MESSAGE = '尚未偵測到 MWI Market Radar 腳本';
export const NO_SNAPSHOTS_MESSAGE = '尚無市場快照，請保持 MWI 分頁開啟';
export const STALE_COLLECTION_MESSAGE = '等待遊戲分頁／資料已停止更新';
export const POLL_FAILURE_MESSAGE = '市場資料更新失敗，保留舊資料';
export const SETTINGS_FAILURE_MESSAGE = '設定儲存失敗';
export const PREFERENCES_WARNING_MESSAGE = '偏好設定無法讀取，本次使用預設值；變更可能無法保存';

export type DashboardDataSource = 'cloud' | 'cloud+local' | 'local-fallback' | 'unavailable';

export interface DashboardDataSourceInfo {
  source: Exclude<DashboardDataSource, 'unavailable'>;
  latestTimestamp: number | null;
  generatedAt: string | null;
  historySourceLabel: string | null;
  stale: boolean;
}

export const DATA_SOURCE_LABELS: Record<DashboardDataSource, string> = {
  cloud: '雲端共同行情',
  'cloud+local': '雲端＋本機備援',
  'local-fallback': '本機備援',
  unavailable: '資料不可用',
};

export const MAX_DATE_MS = 8_640_000_000_000_000;

const GAP_THRESHOLD_HOURS = 1.75;
const STALE_AFTER_HOURS = 2.5;
const SAFE_TRANSIENT_ERRORS = new Set([
  '自選儲存失敗',
  SETTINGS_FAILURE_MESSAGE,
  PREFERENCES_WARNING_MESSAGE,
  POLL_FAILURE_MESSAGE,
]);
const UNKNOWN_ERROR_MESSAGE = '採集發生未知錯誤，保留舊資料';

export interface SnapshotGap {
  from: number;
  to: number;
  hours: number;
}

export interface CollectionHealthModel {
  state: CollectorStatus['state'];
  headline: string;
  detail: string;
  gaps: SnapshotGap[];
  gapCount: number;
  latestTimestamp: number | null;
  stale: boolean;
}

export function isDateRepresentable(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isSafeInteger(value)
    && Math.abs(value) <= MAX_DATE_MS;
}

export function formatTaipeiTime(timestamp: number | null): string {
  if (!isDateRepresentable(timestamp)) return '—';

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

/** Return observed snapshot gaps without filling or interpolating missing data. */
export function detectSnapshotGaps(snapshots: readonly Snapshot[]): SnapshotGap[] {
  const allTimestamps = [...new Set(
    snapshots
      .map((snapshot) => snapshot.timestamp)
      .filter(isDateRepresentable),
  )].sort((left, right) => left - right);
  const latest = allTimestamps.at(-1);
  const timestamps = latest === undefined
    ? allTimestamps
    : allTimestamps.filter((timestamp) => timestamp >= latest - CLOUD_RETENTION_MS);
  const gaps: SnapshotGap[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const from = timestamps[index - 1];
    const to = timestamps[index];
    if (from === undefined || to === undefined) continue;
    const difference = to - from;
    if (!Number.isFinite(difference) || difference <= 0) continue;
    const hours = difference / 3_600_000;
    if (Number.isFinite(hours) && hours > GAP_THRESHOLD_HOURS) gaps.push({ from, to, hours });
  }
  return gaps;
}

const ERROR_MESSAGES: Record<string, string> = {
  network: '網路讀取失敗，保留舊資料',
  schema: '官方資料格式異常，保留舊資料',
  storage: '本機儲存失敗，保留舊資料',
  lock: '無法取得採集鎖，等待下一次採集',
  cancel: '採集已取消，等待下一次採集',
  unknown: UNKNOWN_ERROR_MESSAGE,
};

function latestTimestamp(snapshots: readonly Snapshot[]): number | null {
  return snapshots.reduce<number | null>((latest, snapshot) => {
    if (!isDateRepresentable(snapshot.timestamp)) return latest;
    return latest === null || snapshot.timestamp > latest ? snapshot.timestamp : latest;
  }, null);
}

function gapDetail(gaps: readonly SnapshotGap[]): string {
  if (gaps.length === 0) return '沒有觀測到資料缺口';
  const ranges = gaps.map((gap) => `${formatTaipeiTime(gap.from)} → ${formatTaipeiTime(gap.to)}（${gap.hours} 小時）`);
  return `資料缺口 ${gaps.length} 段：${ranges.join('；')}`;
}

/** Build a safe, user-facing collection health model from persisted facts only. */
export function buildHealthModel(
  status: CollectorStatus,
  snapshots: readonly Snapshot[],
  now = Date.now(),
): CollectionHealthModel {
  const gaps = detectSnapshotGaps(snapshots);
  const latest = latestTimestamp(snapshots);
  const stale = !isDateRepresentable(status.lastSuccessAt)
    || (isDateRepresentable(now) && now - status.lastSuccessAt > STALE_AFTER_HOURS * 3_600_000);

  let headline: string;
  let detail: string;
  if (status.state === 'retrying') {
    headline = '採集重試中';
    detail = status.nextRunAt === null
      ? '將在稍後重試。'
      : `下次重試：${formatTaipeiTime(status.nextRunAt)}`;
    if (latest === null) detail += ` ${NO_SNAPSHOTS_MESSAGE}`;
  } else if (status.state === 'error') {
    headline = '採集發生問題';
    detail = ERROR_MESSAGES[status.lastErrorCode ?? 'unknown'] ?? UNKNOWN_ERROR_MESSAGE;
    if (latest === null) detail += ` ${NO_SNAPSHOTS_MESSAGE}`;
  } else if (latest === null) {
    headline = NO_SNAPSHOTS_MESSAGE;
    detail = '請保持 MWI 分頁開啟，等待下一個官方快照。';
  } else if (stale) {
    headline = STALE_COLLECTION_MESSAGE;
    detail = '請確認遊戲分頁仍開啟，資料不會自動補齊。';
  } else if (status.state === 'checking') {
    headline = '正在採集市場資料';
    detail = '等待官方快照完成。';
  } else {
    headline = '市場資料更新正常';
    detail = '官方快照持續由本機採集器讀取。';
  }

  return {
    state: status.state,
    headline,
    detail: `${detail} ${gapDetail(gaps)}`,
    gaps,
    gapCount: gaps.length,
    latestTimestamp: latest,
    stale,
  };
}

export const deriveHealthModel = buildHealthModel;
export const buildCollectionHealth = buildHealthModel;

function field(label: string, key: string, value: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'status-field';
  wrapper.dataset.statusField = key;

  const labelElement = document.createElement('span');
  labelElement.className = 'status-label';
  labelElement.textContent = label;
  wrapper.append(labelElement);

  const valueElement = document.createElement('strong');
  valueElement.className = 'status-value';
  valueElement.textContent = value;
  wrapper.append(valueElement);
  return wrapper;
}

export function renderCollectorStatus(
  target: HTMLElement,
  status: CollectorStatus,
  transientError: string | null = null,
  health: CollectionHealthModel | null = null,
): void {
  target.replaceChildren();
  target.dataset.statusState = status.state;

  const dot = document.createElement('span');
  const severity = status.state === 'error'
    ? 'error'
    : status.state === 'retrying'
      || status.state === 'checking'
      || health?.stale === true
      || transientError === PREFERENCES_WARNING_MESSAGE
      ? 'warn'
      : 'normal';
  dot.className = `status-dot status-dot-${severity}`;
  target.dataset.statusSeverity = severity;
  dot.setAttribute('aria-hidden', 'true');
  target.append(dot);

  const summary = document.createElement('span');
  summary.className = 'status-summary';
  summary.dataset.statusField = 'state';
  if (health === null) {
    summary.textContent = `採集${STATE_LABELS[status.state]}`;
  } else if (health.latestTimestamp !== null) {
    const time = formatTaipeiTime(health.latestTimestamp).slice(-8);
    summary.textContent = health.stale
      ? `更新逾時 ─ 最後 ${time}`
      : `最後更新 ${time}`;
  } else {
    summary.textContent = health.headline;
  }
  target.append(summary);

  if (transientError !== null && SAFE_TRANSIENT_ERRORS.has(transientError)) {
    const error = document.createElement('span');
    error.className = 'status-error';
    error.dataset.statusError = 'true';
    error.textContent = transientError;
    target.append(error);
  }
}

export function renderBridgeUnavailable(target: HTMLElement, message = NO_BRIDGE_MESSAGE): void {
  target.replaceChildren();
  target.dataset.statusState = 'error';
  target.dataset.statusSeverity = 'error';

  const dot = document.createElement('span');
  dot.className = 'status-dot status-dot-error';
  dot.setAttribute('aria-hidden', 'true');
  target.append(dot);

  const summary = document.createElement('span');
  summary.className = 'status-summary';
  summary.dataset.statusError = 'true';
  summary.textContent = message === NO_BRIDGE_MESSAGE ? message : NO_BRIDGE_MESSAGE;
  target.append(summary);
}

/** Render a minimal source indicator; verbose metadata removed for cleanliness. */
export function renderDataSource(
  target: HTMLElement,
  sourceInfo: DashboardDataSourceInfo | null,
): void {
  const source = sourceInfo?.source ?? 'unavailable';
  target.replaceChildren();
  target.dataset.source = source;

  const label = document.createElement('span');
  label.className = 'data-source-label';
  label.dataset.sourceLabel = 'true';
  label.textContent = DATA_SOURCE_LABELS[source];
  target.append(label);
}
