import './styles.css';

const dashboardMarkup = `
  <div class="radar-shell">
    <header class="topbar" data-testid="topbar">
      <div>
        <p class="eyebrow">Milky Way Idle</p>
        <h1>Market Radar</h1>
      </div>
      <div id="collector-status" class="collector-status" data-testid="collector-status" role="status">
        <span class="status-dot" aria-hidden="true"></span>
        <span>Collector ready</span>
      </div>
    </header>

    <nav id="category-nav" class="category-nav" data-testid="category-nav" aria-label="Market categories">
      <button class="category-tab is-active" type="button">Overview</button>
      <button class="category-tab" type="button">Resources</button>
      <button class="category-tab" type="button">Equipment</button>
      <button class="category-tab" type="button">Consumables</button>
    </nav>

    <section id="toolbar" class="toolbar" data-testid="toolbar" aria-label="Market controls">
      <label class="search-field">
        <span class="sr-only">Search market items</span>
        <input type="search" placeholder="Search items" />
      </label>
      <button class="toolbar-button" type="button">Refresh</button>
    </section>

    <main id="content" class="content" data-testid="content">
      <section class="empty-state" aria-labelledby="empty-state-title">
        <p class="eyebrow">Dashboard shell</p>
        <h2 id="empty-state-title">Market signals will appear here</h2>
        <p>Connect the collector to see current prices and movement.</p>
      </section>
    </main>

    <dialog id="item-detail" aria-labelledby="item-detail-title">
      <form method="dialog" class="dialog-card">
        <div>
          <p class="eyebrow">Item detail</p>
          <h2 id="item-detail-title">Market item</h2>
        </div>
        <button class="toolbar-button" type="submit">Close</button>
      </form>
    </dialog>
  </div>
`;

export function renderApp(root: HTMLElement | null = document.querySelector<HTMLElement>('#app')): void {
  if (!root) {
    throw new Error('Missing #app root');
  }

  root.innerHTML = dashboardMarkup;
}

if (typeof document !== 'undefined' && document.querySelector('#app')) {
  renderApp();
}
