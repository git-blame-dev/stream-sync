import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isBootstrapDebugModeEnabled } from '../../../src/utils/bootstrap-debug-mode';

describe('bootstrap debug selection', () => {
  const originalArgv = [...process.argv];
  const originalEmergencyDebug = process.env.EMERGENCY_DEBUG;

  beforeEach(() => {
    process.argv = ['bun', 'synthetic-bootstrap-entry'];
    delete process.env.EMERGENCY_DEBUG;
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    if (originalEmergencyDebug === undefined) delete process.env.EMERGENCY_DEBUG;
    else process.env.EMERGENCY_DEBUG = originalEmergencyDebug;
  });

  test('accepts the debug argument among other arguments', () => {
    process.argv.push('--chat', '2', '--debug');
    expect(isBootstrapDebugModeEnabled()).toBe(true);
  });

  test('accepts the explicit emergency flag', () => {
    process.env.EMERGENCY_DEBUG = '1';
    expect(isBootstrapDebugModeEnabled()).toBe(true);
  });

  test('rejects absent and other emergency flag values', () => {
    expect(isBootstrapDebugModeEnabled()).toBe(false);
    for (const value of ['0', 'true', '', 'synthetic']) {
      process.env.EMERGENCY_DEBUG = value;
      expect(isBootstrapDebugModeEnabled()).toBe(false);
    }
    process.argv.push('--debugging');
    expect(isBootstrapDebugModeEnabled()).toBe(false);
  });
});
