import { describe, expect, it } from 'vitest';
import { bridgeFixtureSource } from '../e2e/bridge-fixture';

describe('E2E bridge fixture source', () => {
  it('loads as a host module without evaluating fixture template expressions', () => {
    expect(bridgeFixtureSource).toContain(
      'window.postMessage(responsePrefix + JSON.stringify(response), window.location.origin);',
    );
    expect(bridgeFixtureSource).not.toContain('${responsePrefix}');
  });
});
