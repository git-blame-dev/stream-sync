import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildArtifact, copyReleaseSupportFiles, GUI_FILES, SUPPORT_FILES, parseTarget, releaseFiles, validatePackage } from '../../../scripts/release/build-artifact';
import { withNativeChildEnvironment } from '../../helpers/native-child-environment';

const roots: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'release-fixture-'));
  roots.push(root);
  for (const file of [...GUI_FILES, ...SUPPORT_FILES]) await put(root, file);
  return root;
}
async function put(root: string, file: string, contents = 'synthetic release fixture'): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), contents);
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('release artifact filesystem behavior', () => {
  it('accepts only the two supported baseline release targets', () => {
    expect(parseTarget('linux-x64')).toBe('linux-x64');
    expect(parseTarget('windows-x64')).toBe('windows-x64');
    expect(() => parseTarget('unsupported-test-target')).toThrow('Usage:');
    expect(() => parseTarget(undefined)).toThrow('Usage:');
  });
  it('reports a missing external compiler without copying a partial package', async () => {
    const root = await fixture();
    const previousReuse = process.env.STREAM_SYNC_REUSE_GUI_DIST;
    const previousPath = process.env.PATH;
    process.env.STREAM_SYNC_REUSE_GUI_DIST = 'true';
    process.env.PATH = '/synthetic-no-compiler';
    try {
      await expect(buildArtifact('linux-x64', root)).rejects.toThrow();
      expect(await readdir(path.join(root, 'dist/release/stream-sync-linux-x64'))).toEqual([]);
    } finally {
      if (previousReuse === undefined) delete process.env.STREAM_SYNC_REUSE_GUI_DIST;
      else process.env.STREAM_SYNC_REUSE_GUI_DIST = previousReuse;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
  it('requires every current GUI entry and both stylesheets', () => {
    expect(GUI_FILES.filter(file => file.endsWith('.js')).map(file => path.basename(file)).sort()).toEqual([
      'demo.js', 'dock.js', 'goal.js', 'operator.js', 'overlay.js'
    ]);
    expect(GUI_FILES).toContain('gui/dist/assets/styles.css');
    expect(GUI_FILES).toContain('gui/dist/assets/operator.css');
    expect(GUI_FILES).toContain('gui/dist/assets/preview/avatar-fallback.svg');
  });
  for (const file of [...GUI_FILES, ...SUPPORT_FILES]) {
    it(`rejects missing required ${file} before copying`, async () => {
      const root = await fixture();
      await rm(path.join(root, file));
      const destination = path.join(root, 'package');
      await expect(copyReleaseSupportFiles(destination, root)).rejects.toThrow();
      await expect(readdir(destination)).rejects.toThrow();
    });
  }
  it('copies only the current reachable GUI graph and support allowlist with empty runtime directories', async () => {
    const root = await fixture();
    await put(root, 'gui/dist/assets/dock.js', 'import "./shared-test.js";');
    await put(root, 'gui/dist/assets/shared-test.js', 'export const synthetic = true;');
    for (const file of ['.env', 'config.ini', 'obs/token.json', 'gui/dist/assets/old.js', 'gui/dist/assets/platform-icons/Thumbs.db']) await put(root, file);
    const destination = path.join(root, 'package');
    await copyReleaseSupportFiles(destination, root);
    expect(await releaseFiles(destination)).toEqual([...GUI_FILES, ...SUPPORT_FILES, 'gui/dist/assets/shared-test.js'].sort());
    await expect(validatePackage(destination, 'linux-x64')).rejects.toThrow();
    await put(destination, 'stream-sync');
    await validatePackage(destination, 'linux-x64');
    expect(await readdir(path.join(destination, 'logs'))).toEqual([]);
    expect(await readdir(path.join(destination, 'data'))).toEqual([]);
    await put(destination, 'data/cached-token');
    await expect(validatePackage(destination, 'linux-x64')).rejects.toThrow('empty directory');
    await rm(path.join(destination, 'data/cached-token'));
    await put(destination, '.env');
    await expect(validatePackage(destination, 'linux-x64')).rejects.toThrow('Unexpected release path');
    await rm(path.join(destination, '.env'));
    await put(destination, 'cached-release.zip');
    await expect(validatePackage(destination, 'linux-x64')).rejects.toThrow('Unexpected release path');
    await rm(path.join(destination, 'cached-release.zip'));
    await mkdir(path.join(destination, 'unexpected-empty-directory'));
    await expect(validatePackage(destination, 'linux-x64')).rejects.toThrow('Unexpected release path');
  });
  it('validates Windows executable names and rejects nested leftovers', async () => {
    const root = await fixture();
    const destination = path.join(root, 'package');
    await copyReleaseSupportFiles(destination, root);
    await put(destination, 'stream-sync.exe');
    await validatePackage(destination, 'windows-x64');
    await put(destination, 'obs/token.json');
    await expect(validatePackage(destination, 'windows-x64')).rejects.toThrow('Unexpected release path');
  });
  it('rejects invalid reuse before invoking the external compiler', async () => {
    const root = await fixture();
    await put(root, 'scripts/release/build-artifact.ts', await readFile(path.resolve(__dirname, '../../../scripts/release/build-artifact.ts'), 'utf8'));
    await rm(path.join(root, 'gui/dist/assets/goal.js'));
    const result = Bun.spawnSync([process.execPath, '--no-env-file', path.join(root, 'scripts/release/build-artifact.ts'), 'linux-x64'], {
      env: { NODE_ENV: 'test', STREAM_SYNC_REUSE_GUI_DIST: 'true', PATH: '/synthetic-no-compiler' },
      stdout: 'pipe', stderr: 'pipe'
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('goal.js');
    await expect(readdir(path.join(root, 'dist/release'))).rejects.toThrow();
  });
  it('preserves an existing package when GUI preflight fails', async () => {
    const root = await fixture();
    const previousReuse = process.env.STREAM_SYNC_REUSE_GUI_DIST;
    process.env.STREAM_SYNC_REUSE_GUI_DIST = 'true';
    try {
      await put(root, 'dist/release/stream-sync-linux-x64/previous-package');
      await rm(path.join(root, 'gui/dist/assets/demo.js'));
      await expect(buildArtifact('linux-x64', root)).rejects.toThrow();
      expect(await readFile(path.join(root, 'dist/release/stream-sync-linux-x64/previous-package'), 'utf8')).toBe('synthetic release fixture');
    } finally {
      if (previousReuse === undefined) delete process.env.STREAM_SYNC_REUSE_GUI_DIST;
      else process.env.STREAM_SYNC_REUSE_GUI_DIST = previousReuse;
    }
  });
  it('round trips the production package through local tar and zip with CLI validation', async () => {
    const root = await fixture();
    const destination = path.join(root, 'package');
    await copyReleaseSupportFiles(destination, root);
    await put(destination, 'stream-sync');
    const script = path.resolve(__dirname, '../../../scripts/release/build-artifact.ts');
    for (const format of ['tar', 'zip']) {
      const extracted = path.join(root, `extracted-${format}`);
      await mkdir(extracted);
      const archive = path.join(root, `synthetic.${format}`);
      const commands = format === 'tar'
        ? [['tar', '-cf', archive, '-C', root, 'package'], ['tar', '-xf', archive, '-C', extracted]]
        : [['zip', '-qr', archive, 'package'], ['unzip', '-q', archive, '-d', extracted]];
      for (const command of commands) {
        const result = await withNativeChildEnvironment(env =>
          Bun.spawnSync(command, { cwd: root, env, stdout: 'pipe', stderr: 'pipe' }));
        expect(result.exitCode).toBe(0);
      }
      const result = await withNativeChildEnvironment(env =>
        Bun.spawnSync([process.execPath, '--no-env-file', script, '--verify', 'linux-x64', path.join(extracted, 'package')],
          { cwd: root, env, stdout: 'pipe', stderr: 'pipe' }));
      expect(result.exitCode).toBe(0);
      await validatePackage(path.join(extracted, 'package'), 'linux-x64');
    }
  });
  it('rejects empty and symlinked source files and missing referenced chunks', async () => {
    const root = await fixture();
    await put(root, GUI_FILES[0]!, '');
    await expect(releaseFiles(root)).rejects.toThrow('Invalid release file');
    await rm(path.join(root, GUI_FILES[0]!));
    await symlink(path.join(root, 'README.md'), path.join(root, GUI_FILES[0]!));
    await expect(releaseFiles(root)).rejects.toThrow('Invalid release file');
    await rm(path.join(root, GUI_FILES[0]!));
    await put(root, GUI_FILES[0]!, 'import "./missing.js";');
    await expect(releaseFiles(root)).rejects.toThrow();
    await put(root, GUI_FILES[0]!, 'import "./../../../outside.js";');
    await expect(releaseFiles(root)).rejects.toThrow('Invalid GUI dependency');
  });
});
