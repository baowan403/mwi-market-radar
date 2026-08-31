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
    expect(root?.querySelector('#toolbar')).not.toBeNull();
    expect(root?.querySelector('#content')).not.toBeNull();
    expect(root?.querySelector('#item-detail')).not.toBeNull();
    expect(root?.querySelector('[data-testid="collector-status"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="category-nav"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="toolbar"]')).not.toBeNull();
    expect(root?.querySelector('[data-testid="content"]')).not.toBeNull();
    expect(root?.querySelector('dialog#item-detail')).not.toBeNull();
  });

  it('rejects a missing dashboard mount', () => {
    expect(() => renderApp(null)).toThrowError('Missing #app root');
  });
});
