export const bridgeFixtureSource = String.raw`
(() => {
  const HOUR = 3_600_000;
  const now = Date.now();
  const watchlistStorageKey = 'mwi-radar:e2e-watchlist';
  const chrono = '/items/chrono_gloves::7';
  const chronoTen = '/items/chrono_gloves::10';
  const cowbell = '/items/cowbell::0';
  const apple = '/items/apple::0';
  const coin = '/items/coin::0';
  const unknown = '/items/unknown_item::0';

  const quote = (price, volume, ask = price + 2, bid = price - 2) => ({
    a: ask,
    b: bid,
    p: price,
    v: volume,
  });

  const snapshots = [
    { timestamp: now - 168 * HOUR, quotes: { [chrono]: quote(80, 40), [chronoTen]: quote(80, 20), [cowbell]: quote(100, 10), [apple]: quote(30, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 144 * HOUR, quotes: { [chrono]: quote(85, 45), [chronoTen]: quote(82, 22), [cowbell]: quote(105, 10), [apple]: quote(31, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 120 * HOUR, quotes: { [chrono]: quote(90, 50), [chronoTen]: quote(84, 24), [cowbell]: quote(110, 10), [apple]: quote(32, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 96 * HOUR, quotes: { [chrono]: quote(95, 30), [chronoTen]: quote(86, 26), [cowbell]: quote(115, 10), [apple]: quote(33, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 72 * HOUR, quotes: { [chrono]: quote(100, 30), [chronoTen]: quote(88, 28), [cowbell]: quote(120, 10), [apple]: quote(34, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 48 * HOUR, quotes: { [chrono]: quote(105, 35), [chronoTen]: quote(90, 30), [cowbell]: quote(125, 10), [apple]: quote(35, 20), [coin]: quote(100, 20) } },
    { timestamp: now - 24 * HOUR, quotes: { [chrono]: quote(100, 40), [chronoTen]: quote(95, 32), [cowbell]: quote(100, 10), [apple]: quote(36, 20), [coin]: quote(100, 20) } },
    { timestamp: now, quotes: {
      [chrono]: quote(120, 80, 132, 108),
      [chronoTen]: quote(90, 30),
      [cowbell]: quote(130, 2),
      [apple]: quote(null, 20, 40, null),
      [coin]: quote(100, 15, 130, 70),
      [unknown]: quote(null, null, null, null),
    } },
  ];

  if (new URL(window.location.href).searchParams.has('e2e-many')) {
    const latest = snapshots[snapshots.length - 1];
    if (latest !== undefined) {
      for (let level = 1; level <= 300; level += 1) {
        latest.quotes['/items/coin::' + level] = quote(200 + level, 10 + level);
      }
    }
  }

  const defaultWatchlist = [];
  let watchlist = defaultWatchlist;
  try {
    const stored = JSON.parse(localStorage.getItem(watchlistStorageKey) || 'null');
    if (Array.isArray(stored)) watchlist = stored;
  } catch {
    watchlist = defaultWatchlist;
  }

  const settings = {
    period: '1d',
    minimumVolume: 5,
    maximumSpreadPct: null,
    anomalyMovePct: 5,
    anomalyVolumeMultiple: 2,
  };
  const collectorStatus = {
    state: 'ok',
    lastAttemptAt: now,
    lastSuccessAt: now,
    officialTimestamp: now,
    nextRunAt: now + HOUR,
    lastErrorCode: null,
  };

  const installBridge = () => {
    const target = document.documentElement;
    if (target === null) {
      document.addEventListener('DOMContentLoaded', installBridge, { once: true });
      return;
    }
    target.dataset.mwiRadarBridge = 'ready';
    const send = (id, ok, value, error) => {
      const response = ok ? { id, ok: true, value } : { id, ok: false, error };
      target.dispatchEvent(new CustomEvent('mwi-radar:response', { detail: JSON.stringify(response) }));
    };

    target.addEventListener('mwi-radar:request', (event) => {
      if (typeof event.detail !== 'string') return;
      let request;
      try {
        request = JSON.parse(event.detail);
      } catch {
        return;
      }
      if (request === null || typeof request !== 'object' || typeof request.id !== 'string') return;

      if (request.type === 'bootstrap') {
        send(request.id, true, {
          watchlist,
          settings,
          collectorStatus,
          latestTimestamp: now,
          snapshotCount: snapshots.length,
        });
        return;
      }
      if (request.type === 'snapshots') {
        const newestFirst = [...snapshots].sort((left, right) => right.timestamp - left.timestamp);
        const eligible = request.beforeTimestamp === null
          ? newestFirst
          : newestFirst.filter((snapshot) => snapshot.timestamp < request.beforeTimestamp);
        const items = eligible.slice(0, request.limit);
        const hasMore = items.length < eligible.length;
        send(request.id, true, {
          items,
          nextBeforeTimestamp: hasMore ? items[items.length - 1].timestamp : null,
          hasMore,
        });
        return;
      }
      if (request.type === 'set-watchlist' && Array.isArray(request.value)) {
        watchlist = request.value;
        localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlist));
        send(request.id, true, { acknowledged: true });
        return;
      }
      if (request.type === 'set-settings' && request.value !== null && typeof request.value === 'object' && !Array.isArray(request.value)) {
        Object.assign(settings, request.value);
        send(request.id, true, { acknowledged: true });
        return;
      }
      send(request.id, false, undefined, { code: 'invalid_request', message: 'Invalid bridge request' });
    });

    window.__mwiRadarE2eFixture = { snapshots, getWatchlist: () => watchlist };
  };

  installBridge();
})();
`;
