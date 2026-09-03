// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateRadarSnapshot,
  installRadarExportButton,
} from '../src/userscript/radar-exporter';

describe('radar exporter userscript module', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns null before game character data is received', () => {
    expect(generateRadarSnapshot()).toBeNull();
  });

  it('renders export button on DOM properly', () => {
    installRadarExportButton();
    const btn = document.getElementById('mwi-radar-export-btn');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('導出 Radar 快照');
  });
});
