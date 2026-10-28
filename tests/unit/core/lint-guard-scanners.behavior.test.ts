import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const repositoryRoot = path.resolve(__dirname, '../../..');
const fixtureRoots: string[] = [];
// Assemble scanner examples without making this test itself a rule violation.
const call = (name: string, args = 'callback, 1') => `${name}(${args});`;
const rawTimeout = () => call(['set', 'Timeout'].join(''));
const cases = [
  { guard: 'no-raw-timeouts', invalid: rawTimeout(), valid: call('safeSetTimeout'), diagnostic: 'Raw timeout usage detected' },
  { guard: 'no-mock-timers-in-tests', invalid: ['safeSetTimeout:', '(callback) => callback()'].join(' '), valid: 'const options = { enabled: true };', diagnostic: 'Injecting mock safeSetTimeout' },
  { guard: 'no-implementation-test-patterns', invalid: ['let', 'capturedHandler;'].join(' '), valid: 'expect(result).toBe(true);', diagnostic: 'Manual callback capture variable' },
  { guard: 'no-implicit-test-defaults', invalid: ['const auth = twitchAuth', '|| {};'].join(' '), valid: 'const auth = twitchAuth ?? null;', diagnostic: 'Implicit mock defaults found' },
  { guard: 'no-nondeterministic-test-values', invalid: call(['Math', 'random'].join('.'), ''), valid: 'const syntheticId = "synthetic-test-id";', diagnostic: ['Math', 'random() in test code'].join('.') },
  { guard: 'prefer-double-bang', invalid: `const enabled = ${call(['Bool', 'ean'].join(''), 'value')}`, valid: 'const enabled = !!value;', diagnostic: 'Prefer !! over' }
];

async function fixture(files: ReadonlyArray<readonly [string, string]>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'lint-guard-fixture-'));
  fixtureRoots.push(root);
  for (const [relativePath, contents] of files) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return root;
}

function scan(guard: string, root: string) {
  const result = Bun.spawnSync([process.execPath, path.join(repositoryRoot, 'scripts/lint', `${guard}.ts`), root], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('lint guard production CLI scanners', () => {
  for (const { guard, invalid, valid, diagnostic } of cases) {
    it(`${guard} accepts valid code and rejects its actual rule violation`, async () => {
      const root = await fixture([['tests/unit/sample.test.ts', valid]]);
      const clean = scan(guard, root);
      expect(clean.code).toBe(0);
      expect(clean.stderr).toBe('');
      await writeFile(path.join(root, 'tests/unit/sample.test.ts'), `\n${invalid}\n`);
      const rejected = scan(guard, root);
      expect(rejected.code).toBe(1);
      expect(rejected.stderr).toContain(diagnostic);
      expect(rejected.stderr).toContain('tests/unit/sample.test.ts');
      expect(rejected.stderr).toMatch(/(?:sample\.test\.ts:2|Line 2:)/);
    });

    it(`${guard} emits identical codepoint-ordered diagnostics regardless of creation order`, async () => {
      const names = ['tests/unit/a.test.ts', 'tests/unit/a/Z.test.ts', 'tests/unit/_nested/z.test.ts', 'tests/unit/Z.test.ts'];
      const files = names.map(name => [name, `\n${invalid}\n${invalid}\n`] as const);
      const firstRoot = await fixture(files);
      const secondRoot = await fixture([...files].reverse());
      const first = scan(guard, firstRoot);
      const second = scan(guard, secondRoot);
      expect(first.code).toBe(1);
      expect(second.code).toBe(1);
      expect(first.stderr).toBe(second.stderr);
      const paths = first.stderr.split('\n').filter(line => /tests\/unit\/.*\.test\.ts(?::\d+)?(?:\s|:|$)/.test(line))
        .map(line => line.trim().replace(/:\d+.*$/, '').replace(/:$/, ''));
      expect([...new Set(paths)]).toEqual([
        'tests/unit/Z.test.ts', 'tests/unit/_nested/z.test.ts', 'tests/unit/a.test.ts', 'tests/unit/a/Z.test.ts'
      ]);
      for (const name of names) {
        expect(first.stderr).toContain(name);
      }
    });
  }

  it('raw timer guard allows exact safe helpers but not unrelated safe suffix context or member calls', async () => {
    const root = await fixture([['src/sample.ts', [call('safeSetTimeout'), call('safeSetInterval'), call('$setTimeout')].join('\n')]]);
    expect(scan('no-raw-timeouts', root).code).toBe(0);
    await writeFile(path.join(root, 'src/sample.ts'), [
      `if (isSafe) ${rawTimeout()}`,
      `const unsafe = true; if (unsafe) ${rawTimeout()}`,
      `const note = "unsafe ${rawTimeout()}";`,
      `foo.safe.${rawTimeout()}`,
      call(['globalThis.set', 'Interval'].join(''))
    ].join('\n'));
    const result = scan('no-raw-timeouts', root);
    expect(result.code).toBe(1);
    for (const line of [1, 2, 3, 4, 5]) expect(result.stderr).toContain(`src/sample.ts:${line}`);
  });

  it('raw timer guard excludes only repository scripts/lint, retaining other existing exclusions', async () => {
    const root = await fixture([
      ['scripts/lint/guard.ts', rawTimeout()],
      ['src/node_modules/vendor.ts', rawTimeout()],
      ['src/archive/old.ts', rawTimeout()],
      ['src/coverage/output.ts', rawTimeout()],
      ['src/logs/output.ts', rawTimeout()]
    ]);
    expect(scan('no-raw-timeouts', root).code).toBe(0);
    await mkdir(path.join(root, 'src/nested/lint'), { recursive: true });
    await writeFile(path.join(root, 'src/nested/lint/current.ts'), rawTimeout());
    const result = scan('no-raw-timeouts', root);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('src/nested/lint/current.ts:1');
    expect(result.stderr).not.toContain('scripts/lint/guard.ts');
  });

  for (const property of ['safeSetTimeout', 'clearTimeoutFn']) {
    for (const parameter of ['callback', '(callback)', '$callback', '(_callback)']) {
      it(`detects injected ${property} with ${parameter} arrow parameter`, async () => {
        const root = await fixture([['tests/unit/arrow.test.ts', `const options = { ${property}: ${parameter} => undefined };`]]);
        const result = scan('no-mock-timers-in-tests', root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain(`Injecting mock ${property}`);
        expect(result.stderr).toContain('tests/unit/arrow.test.ts:1');
      });
    }
  }
});
