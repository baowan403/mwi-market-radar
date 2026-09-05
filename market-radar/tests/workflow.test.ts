import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowPath = fileURLToPath(new URL('../../.github/workflows/market-radar-pages.yml', import.meta.url));
const workflow = readFileSync(workflowPath, 'utf8');

describe('market radar Pages workflow', () => {
  it('repairs gaps after official collection without blocking it when upstream fails', () => {
    const step = workflow.match(/- name: Repair missing market hours[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
    expect(step).toContain("if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'");
    expect(step).toContain('if ! npm run cloud:backfill-stockmarket');
    expect(step).toContain('--repair-gaps');
    expect(step).toContain('::warning::');
    expect(workflow.indexOf('Repair missing market hours')).toBeGreaterThan(workflow.indexOf('Collect the official snapshot'));
    expect(workflow.indexOf('Repair missing market hours')).toBeLessThan(workflow.indexOf('Validate market-data history'));
  });
  it('has the required triggers, least practical permissions, and fixed concurrency', () => {
    expect(workflow).toContain('push:');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('cron: "13,28,43,58 * * * *"');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('uses pinned build actions and Node 22 with npm ci in market-radar', () => {
    expect(workflow).toContain(
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
    );
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4',
    );
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

  it('gates the authorized history backfill behind its explicit manual boolean input', () => {
    const backfillStep = workflow.match(
      /- name: Backfill the authorized seven-day public history[\s\S]*?(?=\n      - name:)/,
    )?.[0] ?? '';

    expect(workflow).toContain('  workflow_dispatch:\n    inputs:\n      backfill_stockmarket_7d:');
    expect(workflow).toContain('description: "One-time authorized stockmarket.xin seven-day backfill"');
    expect(workflow).toContain('required: false');
    expect(workflow).toContain('type: boolean');
    expect(workflow).toContain('default: false');
    expect(backfillStep).toContain(
      "if: github.event_name == 'workflow_dispatch' && inputs.backfill_stockmarket_7d == true",
    );
    expect(backfillStep).toContain('working-directory: market-radar');
    expect(backfillStep).toContain('DATA_WT: ${{ steps.data-worktree.outputs.path }}');
    expect(backfillStep).toContain(
      'npm run cloud:backfill-stockmarket -- --data-dir "$DATA_WT/data"',
    );
    expect(backfillStep).not.toContain("github.event_name == 'schedule'");
    expect(backfillStep).not.toContain("github.event_name == 'push'");
    expect(workflow.indexOf('Collect the official snapshot')).toBeLessThan(
      workflow.indexOf('Backfill the authorized seven-day public history'),
    );
  });

  it('copies and validates data before tests/build and Pages upload/deploy', () => {
    expect(workflow).toContain('public/data');
    expect(workflow).toContain('manifest.json');
    expect(workflow).toContain(
      'actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5',
    );
    expect(workflow).toContain(
      'actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4',
    );
    expect(workflow).toContain(
      'actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4',
    );
    expect(workflow).toContain('needs: build');
    expect(workflow.indexOf('cloud:validate')).toBeLessThan(workflow.indexOf('npm test'));
    expect(workflow.indexOf('npm run build')).toBeLessThan(
      workflow.indexOf('actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b'),
    );
    expect(workflow.indexOf('actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b')).toBeLessThan(
      workflow.indexOf('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'),
    );
  });

  it('publishes data only after validation, build, and Pages artifact upload', () => {
    const positions = [
      workflow.indexOf('npm run cloud:update'),
      workflow.indexOf('npm run cloud:validate'),
      workflow.indexOf('npm test -- --run'),
      workflow.indexOf('npm run build'),
      workflow.indexOf('actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b'),
      workflow.indexOf('git push origin HEAD:market-data'),
      workflow.indexOf('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e'),
    ];

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('exposes data publication state and has guarded rollback for existing branches', () => {
    expect(workflow).toContain('data_changed: ${{ steps.publish-data.outputs.data_changed }}');
    expect(workflow).toContain('data_commit_sha: ${{ steps.publish-data.outputs.data_commit_sha }}');
    expect(workflow).toContain('previous_data_sha: ${{ steps.data-worktree.outputs.previous_data_sha }}');
    expect(workflow).toContain('data_branch_created: ${{ steps.data-worktree.outputs.data_branch_created }}');

    const rollback = workflow.slice(workflow.indexOf('\n  rollback-data:'));
    expect(rollback).toContain('if: ${{ always()');
    expect(rollback).toContain("needs.deploy.result == 'failure'");
    expect(rollback).toContain("needs.build.outputs.data_changed == 'true'");
    expect(rollback).toContain("needs.build.outputs.data_branch_created == 'false'");
    expect(rollback).toContain("needs.build.outputs.previous_data_sha != ''");
    expect(rollback).toContain(
      'git fetch origin refs/heads/market-data:refs/remotes/origin/market-data',
    );
    expect(rollback).toContain('test "$CURRENT_SHA" = "$DATA_COMMIT_SHA"');
    expect(rollback).toContain('git revert --no-edit "$DATA_COMMIT_SHA"');
    expect(rollback).toContain(
      'test "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "$PREVIOUS_DATA_SHA^{tree}")"',
    );
    expect(rollback).not.toContain('test "$(git rev-parse HEAD)" = "$PREVIOUS_DATA_SHA"');
    expect(rollback).toContain("git config user.name 'github-actions[bot]'");
    expect(rollback).toContain(
      "git config user.email '41898282+github-actions[bot]@users.noreply.github.com'",
    );
    expect(rollback.indexOf("git config user.name 'github-actions[bot]'")).toBeLessThan(
      rollback.indexOf('git revert --no-edit "$DATA_COMMIT_SHA"'),
    );
    expect(
      rollback.indexOf(
        "git config user.email '41898282+github-actions[bot]@users.noreply.github.com'",
      ),
    ).toBeLessThan(rollback.indexOf('git revert --no-edit "$DATA_COMMIT_SHA"'));
    expect(rollback).toContain('git push origin HEAD:market-data');
  });

  it('pins every external action to an immutable 40-hex commit', () => {
    const refs = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)/gm)].map((match) => match[1] ?? '');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => /^[^@]+@[0-9a-f]{40}$/.test(ref))).toBe(true);
  });

  it('does not include private-data channels or a hardcoded repository owner', () => {
    expect(workflow).not.toMatch(/cookie|authorization|character|private/i);
    expect(workflow).not.toMatch(/github\.com\/[A-Za-z0-9_.-]+\//i);
  });
});
