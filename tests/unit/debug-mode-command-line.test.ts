import { describe, expect, test } from 'bun:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { withNativeChildEnvironment } from '../helpers/native-child-environment';

const execute = promisify(execFile);
const repositoryRoot = resolve(__dirname, '../..');

describe('debug mode through the actual main entry', () => {
  for (const { args, configEnabled, expected } of [
    { args: [], configEnabled: false, expected: false },
    { args: ['--debug'], configEnabled: false, expected: true },
    { args: [], configEnabled: true, expected: true },
    { args: ['--chat', '2', '--debug'], configEnabled: false, expected: true },
    { args: ['--debug', '--chat', '2'], configEnabled: true, expected: true },
  ]) {
    test(`argv ${JSON.stringify(args)}, configured ${configEnabled}`, async () => {
      const script = `
        process.argv = ['bun', 'synthetic-debug-entry', ...${JSON.stringify(args)}];
        const { createMainPresentationFixture } = await import('./tests/helpers/main-presentation-fixture.ts');
        const { getLoggingConfig } = await import('./src/core/logging.ts');
        const fixture = await createMainPresentationFixture();
        try {
          fixture.config.general.debugEnabled = ${configEnabled};
          fixture.config.logging.file.enabled = false;
          await fixture.start();
          process.stdout.write('SYNTHETIC_DEBUG_RESULT=' + JSON.stringify(getLoggingConfig().console?.level === 'debug') + '\\n');
        } finally {
          await fixture.dispose();
        }
      `;
      const { stdout } = await withNativeChildEnvironment(env => execute(process.execPath,
        ['--no-env-file', '-e', script], { cwd: repositoryRoot, env, timeout: 10000, maxBuffer: 1024 * 1024 }));
      expect(stdout.match(/SYNTHETIC_DEBUG_RESULT=(true|false)/g)).toEqual([`SYNTHETIC_DEBUG_RESULT=${expected}`]);
    }, 15000);
  }

});
