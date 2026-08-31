import type { CollectorStatus } from '../core/types';

const STATE_LABELS: Record<CollectorStatus['state'], string> = {
  idle: '待機',
  checking: '採集中',
  retrying: '重試中',
  ok: '正常',
  error: '錯誤',
};

export const NO_BRIDGE_MESSAGE = '尚未偵測到 MWI Market Radar 腳本';

export function formatTaipeiTime(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return '—';

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
): void {
  target.replaceChildren();
  target.dataset.statusState = status.state;

  const dot = document.createElement('span');
  dot.className = 'status-dot';
  dot.setAttribute('aria-hidden', 'true');
  target.append(dot);

  const summary = document.createElement('span');
  summary.className = 'status-summary';
  summary.dataset.statusField = 'state';
  summary.textContent = `採集${STATE_LABELS[status.state]} (${status.state})`;
  target.append(summary);

  const details = document.createElement('div');
  details.className = 'status-details';
  details.append(field('官方快照', 'official', formatTaipeiTime(status.officialTimestamp)));
  details.append(field('本機採集', 'collected', formatTaipeiTime(status.lastSuccessAt)));
  details.append(field('下次採集', 'next', formatTaipeiTime(status.nextRunAt)));
  target.append(details);

  if (transientError !== null) {
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

  const dot = document.createElement('span');
  dot.className = 'status-dot status-dot-error';
  dot.setAttribute('aria-hidden', 'true');
  target.append(dot);

  const summary = document.createElement('span');
  summary.className = 'status-summary';
  summary.dataset.statusError = 'true';
  summary.textContent = message;
  target.append(summary);
}
