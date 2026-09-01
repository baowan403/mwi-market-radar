import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowPath = fileURLToPath(new URL('../../.github/workflows/market-radar-pages.yml', import.meta.url));
const workflow = readFileSync(workflowPath, 'utf8');

describe('market radar Pages workflow', () => {
  it('has the required triggers, least practical permissions, and fixed concurrency', () => {
    expect(workflow).toContain('push:');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('cron: "13 * * * *"');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('uses pinned build actions and Node 22 with npm ci in market-radar', () => {
    expect(workflow).toContain('actions/checkout@v6');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('actions/setup-node@v4');
    expect(workflow).toMatch(/node-version:\s*["']?22["']?/);
    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('cache-dependency-path: market-radar/package-lock.json');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('working-directory: market-radar');
  });

  it('prepares market-data safely, collects when needed, validates, and pushes only data', () => {
    expect(workflow).toContain('RUNNER_TEMP');
    expect(workflow).toContain('market-data');
    expect(workflow).toContain('refs/heads/market-data');
    expect(workflow).toContain('cloud:update');
    expect(workflow).toContain('--data-dir');
    expect(workflow).toContain('--source-url https://www.milkywayidle.com/game_data/marketplace.json');
    expect(workflow).toContain('--min-quotes 1000');
    expect(workflow).toContain('cloud:validate');
    expect(workflow).toContain('git add -- data');
    expect(workflow).toContain('git push origin HEAD:market-data');
    expect(workflow).toContain('github-actions[bot]');
  });

  it('collects only for scheduled or manual runs, never for source pushes', () => {
    const collectStep = workflow.match(
      /- name: Collect the official snapshot[\s\S]*?(?=\n      - name:)/,
    )?.[0] ?? '';
    const pushGuard = workflow.match(
      /- name: Require existing market-data on source pushes[\s\S]*?(?=\n      - name:)/,
    )?.[0] ?? '';

    expect(collectStep).toContain(
      "if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    expect(collectStep).not.toContain("github.event_name == 'push'");
    expect(collectStep).not.toContain('steps.data-worktree.outputs.path ==');
    expect((workflow.match(/cloud:update/g) ?? []).length).toBe(1);

    expect(pushGuard).toContain("if: github.event_name == 'push'");
    expect(pushGuard).toContain('[ ! -f "$DATA_WT/data/manifest.json" ]');
    expect(pushGuard).toContain(
      'market-data is not initialized; run workflow_dispatch to bootstrap cloud history.',
    );
    expect(pushGuard).toContain('exit 1');
    expect(pushGuard).not.toContain('cloud:update');
    expect(workflow.indexOf('Require existing market-data on source pushes')).toBeLessThan(
      workflow.indexOf('Collect the official snapshot'),
    );
  });

  it('copies and validates data before tests/build and Pages upload/deploy', () => {
    expect(workflow).toContain('public/data');
    expect(workflow).toContain('manifest.json');
    expect(workflow).toContain('actions/configure-pages@v5');
    expect(workflow).toContain('actions/upload-pages-artifact@v4');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('needs: build');
    expect(workflow.indexOf('cloud:validate')).toBeLessThan(workflow.indexOf('npm test'));
    expect(workflow.indexOf('npm run build')).toBeLessThan(workflow.indexOf('actions/upload-pages-artifact@v4'));
    expect(workflow.indexOf('actions/upload-pages-artifact@v4')).toBeLessThan(workflow.indexOf('actions/deploy-pages@v4'));
  });

  it('does not include private-data channels or a hardcoded repository owner', () => {
    expect(workflow).not.toMatch(/cookie|authorization|character|private/i);
    expect(workflow).not.toMatch(/github\.com\/[A-Za-z0-9_.-]+\//i);
  });
});
