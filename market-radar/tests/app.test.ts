// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../src/app';

describe('market radar dashboard shell', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it('renders the required dashboard regions into #app', () => {
    const root = document.querySelector<HTMLElement>('#app');
    expect(root).not.toBeNull();

    renderApp(root as HTMLElement);

    expect(root?.querySelector('[data-testid="topbar"]')?.textContent).toContain('Milky Way Idle');
    expect(root?.querySelector('[data-testid="topbar"]')?.textContent).toContain('Market Radar');
    expect(root?.querySelector('#collector-status')).not.toBeNull();
    expect(root?.querySelector('#category-nav')).not.toBeNull();
    expect(root?.querySelector('#product-nav')).not.toBeNull();
    expect(root?.querySelector('[data-product-surface="strategy"]')?.textContent).toBe('策略推薦');
    expect(root?.querySelector('#toolbar')).not.toBeNull();
    expect(root?.querySelector('#content')).not.toBeNull();
    expect(root?.querySelector('#item-detail')).not.toBeNull();
    expect(root?.querySelector('[data-testid="collector-status"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="category-nav"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="toolbar"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(root?.querySelector('dialog#item-detail')).not.toBeNull();
  });

  it('keeps dashboard content within the single application main', () => {
    const root = document.querySelector<HTMLElement>('#app');
    expect(root).not.toBeNull();

    renderApp(root as HTMLElement);

    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(root?.querySelector('#content')?.tagName).toBe('SECTION');
  });

  it('scopes live announcements to collector status', () => {
    const root = document.querySelector<HTMLElement>('#app');
    expect(root).not.toBeNull();

    renderApp(root as HTMLElement);

    expect(root?.getAttribute('aria-live')).toBeNull();
    expect(root?.querySelector('#collector-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('verifies strategy tab is active by default and market tab is retired', () => {
    const root = document.querySelector<HTMLElement>('#app');
    expect(root).not.toBeNull();

    renderApp(root as HTMLElement);

    const strategyTab = root?.querySelector('[data-product-surface="strategy"]');
    const marketTab = root?.querySelector('[data-product-surface="market"]');
    expect(strategyTab).not.toBeNull();
    expect(strategyTab?.classList.contains('is-active')).toBe(true);
    expect(strategyTab?.getAttribute('aria-pressed')).toBe('true');
    expect(marketTab).toBeNull();
  });

  it('rejects a missing dashboard mount', () => {
    expect(() => renderApp(null)).toThrowError('Missing #app root');
  });
});
