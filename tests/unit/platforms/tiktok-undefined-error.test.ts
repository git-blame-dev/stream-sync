import { expect, test } from 'bun:test';
import { TikTokPlatform } from '../../../src/platforms/tiktok';
import { noOpLogger } from '../../helpers/mock-factories';

test('the actual TikTok error classifier handles absent messages and still classifies network errors', async () => {
  const platform = new TikTokPlatform({ enabled: false, username: 'synthetic-error-user', dataLoggingEnabled: false }, { logger: noOpLogger });
  try {
    for (const error of [{}, { message: undefined }, undefined, null]) {
      expect(platform._handleConnectionError(error)).toEqual({ errorCategory: 'unknown', username: 'synthetic-error-user' });
    }
    expect(platform._handleConnectionError(new Error('Synthetic TLS failure')))
      .toEqual({ errorCategory: 'network', username: 'synthetic-error-user' });
  } finally {
    await platform.cleanup();
  }
});
