import { describe, expect, it } from 'bun:test';
import { logger as appLogger } from '../../../src/core/logging';
import { RawPlatformDataLoggingService } from '../../../src/services/RawPlatformDataLoggingService';

const testLogger = {
  config: {},
  outputs: {
    console: { write() {} },
    file: { config: {}, fileAppender: null, write() {} },
  },
  reconfigure() {},
  log() {},
  shouldOutput: () => false,
  info() {},
  warn() {},
  error() {},
  debug() {},
  emergency() {},
  console() {},
} satisfies typeof appLogger;

describe('raw platform data logging service module import', () => {
  it('exposes RawPlatformDataLoggingService as a named export', () => {
    expect(typeof RawPlatformDataLoggingService).toBe('function');
  });

  it('constructs the named export with logger/config dependencies', () => {
    const service = new RawPlatformDataLoggingService({
      logger: testLogger,
      config: {},
    });

    expect(typeof service.logRawPlatformData).toBe('function');
  });
});
