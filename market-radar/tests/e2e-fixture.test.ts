import { describe, expect, it } from 'vitest';
import { bridgeFixtureSource } from '../e2e/bridge-fixture';
import { createCloudFixture } from '../e2e/cloud-fixture';

describe('E2E bridge fixture source', () => {
  it('loads as a host module without evaluating fixture template expressions', () => {
    expect(bridgeFixtureSource).toContain(
      "target.dispatchEvent(new CustomEvent('mwi-radar:response', { detail: JSON.stringify(response) }));",
    );
    expect(bridgeFixtureSource).not.toContain('${responsePrefix}');
  });

  it('builds a bounded cloud fixture from the real codec and manifest contract', async () => {
    const fixture = await createCloudFixture();

    expect(fixture.snapshots).toHaveLength(25);
    expect(fixture.manifest.snapshots).toHaveLength(25);
    expect(fixture.manifest.latestTimestamp).toBe(fixture.snapshots.at(-1)?.timestamp);
    expect(Object.keys(fixture.snapshots.at(-1)?.quotes ?? {})).toHaveLength(306);
  });
});
