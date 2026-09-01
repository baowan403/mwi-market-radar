import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const projectRoot = resolve(sourceRoot, '..');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('production privacy boundary', () => {
  it('contains no private browser/game channels or trading APIs', () => {
    const contents = sourceFiles(sourceRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    for (const token of [
      /document\.cookie/,
      /localStorage/,
      /sessionStorage/,
      /\/v1\/characters/,
      /WebSocket/,
      /api\.milkywayidle\.com/,
      /unsafeWindow/,
      /\b(?:order|buy|sell|cancel)\s*\(/i,
    ]) {
      expect(contents).not.toMatch(token);
    }
  });

  it('limits production fetch call sites to official marketplace and relative catalog', () => {
    const files = sourceFiles(sourceRoot);
    const fetchLocations = files.flatMap((path) => readFileSync(path, 'utf8').split('\n')
      .map((line, index) => ({ path, line, index: index + 1 }))
      .filter(({ line }) => /\bfetch\s*\(|\bglobalThis\.fetch\b/.test(line)));

    expect(fetchLocations.length).toBeGreaterThan(0);
    for (const location of fetchLocations) {
      const allowed = location.path.endsWith('official-client.ts')
        || location.path.endsWith('cloud-client.ts')
        || (location.path.endsWith('app.ts') && (
          location.line.includes("fetch('./catalog.json'")
          || location.line.includes("fetch('./strategy-data.json'")
        ));
      expect(allowed, `${location.path}:${location.index}`).toBe(true);
    }
  });

  it('keeps local player profiles out of cloud, collector, userscript, and network calls', () => {
    const isolatedSources = [
      resolve(sourceRoot, 'cloud'),
      resolve(sourceRoot, 'collector'),
      resolve(sourceRoot, 'userscript'),
    ].flatMap(sourceFiles).map((path) => readFileSync(path, 'utf8')).join('\n');
    const cloudUpdate = readFileSync(resolve(projectRoot, 'scripts/update-cloud-history.ts'), 'utf8');
    for (const token of ['PlayerProfile', 'active-profile-id', 'characterId', 'profile/import']) {
      expect(isolatedSources).not.toContain(token);
      expect(cloudUpdate).not.toContain(token);
    }

    const panelSource = readFileSync(resolve(sourceRoot, 'profile/panel.ts'), 'utf8');
    expect(panelSource).not.toMatch(/\bfetch\s*\(|postMessage\s*\(|sendBeacon\s*\(/);
  });
});
