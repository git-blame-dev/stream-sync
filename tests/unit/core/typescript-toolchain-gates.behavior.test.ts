import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  main: string;
  scripts: Record<string, string>;
};
const excluded = new Set(['node_modules', '.git', 'dist', 'coverage']);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.isFile() ? [path] : [];
  });
}

const projects = [
  ['src', 'tsconfig.src.json', ['src']],
  ['tests', 'tsconfig.tests.json', ['tests']],
  ['scripts', 'tsconfig.scripts.json', ['scripts']],
  ['tools', 'tsconfig.tools.json', ['tools']],
  ['gui', 'gui/tsconfig.json', ['gui/src']],
  ['gui-node', 'tsconfig.json', ['src/services/gui', 'tests/unit/gui', 'tests/unit/services/gui']],
] as const;

describe('current TypeScript toolchain policy', () => {
  it('keeps executable application and verification lanes free of JavaScript', () => {
    const violations = ['src', 'tests', 'scripts', 'tools'].flatMap(directory => files(join(root, directory)))
      .filter(path => /\.(?:js|cjs|mjs)$/.test(path))
      .map(path => relative(root, path));
    expect(violations).toEqual([]);
  });

  for (const [lane, configPath, directories] of projects) {
    it(`checks all current ${lane} files with inherited strict compiler options`, () => {
      expect(manifest.scripts[`typecheck:${lane}`]).toBe(`tsc --noEmit -p ${configPath}`);
      const configuration = ts.readConfigFile(join(root, configPath), ts.sys.readFile);
      expect(configuration.error).toBeUndefined();
      const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, resolve(root, configPath, '..'));
      expect(parsed.errors).toEqual([]);
      expect(parsed.options.noEmit).toBe(true);
      for (const option of ['strict', 'useUnknownInCatchVariables', 'noImplicitOverride',
        'noFallthroughCasesInSwitch', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess',
        'noImplicitReturns', 'noImplicitThis', 'alwaysStrict', 'forceConsistentCasingInFileNames'] as const) {
        expect(parsed.options[option]).toBe(true);
      }
      const included = new Set(parsed.fileNames.map(path => resolve(path)));
      const currentFiles = directories.flatMap(directory => files(join(root, directory)))
        .filter(path => /\.tsx?$/.test(path));
      if (lane === 'gui') currentFiles.push(join(root, 'gui/vite.config.ts'));
      if (lane === 'gui-node') {
        currentFiles.push(join(root, 'scripts/local/gui-preview.ts'), join(root, 'gui/src/vite-env.d.ts'),
          join(root, 'tests/helpers/gui-transport-test-utils.ts'));
        for (const directory of ['tests/integration', 'tests/e2e-smoke']) {
          currentFiles.push(...files(join(root, directory)).filter(path => /[/\\]gui-[^/\\]+\.tsx?$/.test(path)));
        }
      }
      expect(currentFiles.length).toBeGreaterThan(0);
      expect(currentFiles.filter(path => !included.has(path)).map(path => relative(root, path))).toEqual([]);
    });
  }

  it('runs all six compiler projects in the aggregate gate', () => {
    expect(manifest.scripts['typecheck:all']?.split(' && ')).toEqual(
      projects.map(([lane]) => `bun run typecheck:${lane}`));
    expect(manifest.scripts.verify?.split(' && ')).toEqual([
      'bun run lint', 'bun run typecheck:all', 'bun --no-env-file run test:coverage', 'bun run build',
    ]);
  });

  it('retains executable TypeScript entry and explicit debug start commands', () => {
    expect(manifest.main).toBe('src/bootstrap.ts');
    expect(manifest.scripts.start).toBe('bun src/bootstrap.ts');
    expect(manifest.scripts['start:debug']).toBe('bun src/bootstrap.ts --debug');
    expect(manifest.scripts['start:debug:build']).toBe('bun run build && bun src/bootstrap.ts --debug');
  });

  it('loads both test isolation preloads in order', () => {
    const configuration = Bun.TOML.parse(readFileSync(join(root, 'bunfig.toml'), 'utf8'));
    expect(configuration).toMatchObject({ test: { preload: ['./tests/setup/bun.prerun.ts', './tests/setup/bun.setup.ts'] } });
    expect(manifest.scripts.test).toBe('NODE_ENV=test bun test --no-env-file');
    expect(manifest.scripts['test:coverage']).toContain('bun test --no-env-file --coverage');
  });

  it('wires the actual guard scanners, ESLint and unused-file check into lint', () => {
    expect(manifest.scripts.lint?.split(' && ')).toEqual([
      'bun run lint:guards', 'bun run lint:eslint', 'bun run lint:knip',
    ]);
    expect(manifest.scripts['lint:guards']?.split(' && ')).toEqual([
      'no-raw-timeouts', 'no-mock-timers-in-tests', 'no-implementation-test-patterns',
      'no-implicit-test-defaults', 'no-nondeterministic-test-values', 'prefer-double-bang',
    ].map(name => `bun scripts/lint/${name}.ts`));
    expect(manifest.scripts['lint:knip']).toBe('knip --config knip.json --include files,unlisted');
    expect(manifest.scripts['lint:eslint']).toBe(
      'bun x eslint "src/**/*.ts" "tests/**/*.ts" "scripts/**/*.ts" "tools/**/*.ts" "gui/**/*.{ts,tsx}"');
  });
});
