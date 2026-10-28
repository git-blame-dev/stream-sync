import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

type ReleaseTarget = 'linux-x64' | 'windows-x64';

interface TargetConfig {
  readonly bunTarget: string;
  readonly packageDirectory: string;
  readonly executableName: string;
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const TARGETS: Record<ReleaseTarget, TargetConfig> = {
  'linux-x64': {
    bunTarget: 'bun-linux-x64-baseline',
    packageDirectory: 'stream-sync-linux-x64',
    executableName: 'stream-sync'
  },
  'windows-x64': {
    bunTarget: 'bun-windows-x64-baseline',
    packageDirectory: 'stream-sync-windows-x64',
    executableName: 'stream-sync.exe'
  }
};

export function parseTarget(value: string | undefined): ReleaseTarget {
  if (value === 'linux-x64' || value === 'windows-x64') {
    return value;
  }

  throw new Error('Usage: bun scripts/release/build-artifact.ts <linux-x64|windows-x64>');
}

export const GUI_FILES = ['dock', 'demo', 'overlay', 'operator', 'goal'].map(name => `gui/dist/assets/${name}.js`).concat([
  'gui/dist/assets/styles.css', 'gui/dist/assets/operator.css',
  'gui/dist/assets/preview/avatar-fallback.svg'
]);
export const SUPPORT_FILES = ['config.example.ini', '.env.example', 'README.md',
  ...['browser-wrapper.html', 'browser-wrapper.js', 'browser-wrapper.css', 'demo.html', 'dock.html',
    'goal.html', 'notifications.html', 'overlay.html', 'tiktok-animations.html'].map(name => `obs/${name}`)];

async function requireFile(root: string, file: string): Promise<void> {
  const parts = file.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const info = await lstat(path.join(root, ...parts.slice(0, index)));
    if (info.isSymbolicLink() || (index === parts.length ? !info.isFile() || info.size === 0 : !info.isDirectory())) {
      throw new Error(`Invalid release file: ${file}`);
    }
  }
}

// Vite's entry bundles reference shared chunks by relative URL. Copy only that
// reachable graph, not unrelated files left in a reused dist directory.
export async function releaseFiles(root: string): Promise<string[]> {
  const files = new Set([...GUI_FILES, ...SUPPORT_FILES]);
  for (const file of files) {
    await requireFile(root, file);
    if (!file.startsWith('gui/dist/') || !/\.(js|css)$/.test(file)) continue;
    const contents = await readFile(path.join(root, file), 'utf8');
    for (const match of contents.matchAll(/["'](\.\/[\w./-]+\.(?:js|css|svg|png|woff2?))["']/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]!));
      if (!dependency.startsWith('gui/dist/assets/')) throw new Error(`Invalid GUI dependency: ${dependency}`);
      files.add(dependency);
    }
  }
  return [...files].sort();
}

export async function validatePackage(root: string, target: ReleaseTarget): Promise<void> {
  const files = await releaseFiles(root);
  const executable = TARGETS[target].executableName;
  await requireFile(root, executable);
  const expected = new Set([...files, executable]);
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory() && [...expected].some(file => file.startsWith(`${relative}/`))) await visit(relative);
      else if (!entry.isFile() || !expected.has(relative)) throw new Error(`Unexpected release path: ${relative}`);
    }
  }
  for (const directory of ['logs', 'data']) {
    const info = await lstat(path.join(root, directory));
    if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(path.join(root, directory))).length) {
      throw new Error(`Release ${directory} must be an empty directory`);
    }
  }
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'logs' || entry.name === 'data') continue;
    if (entry.isDirectory() && files.some(file => file.startsWith(`${entry.name}/`))) await visit(entry.name);
    else if (!entry.isFile() || !expected.has(entry.name)) throw new Error(`Unexpected release path: ${entry.name}`);
  }
}

async function run(command: string, args: readonly string[], root: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function copyReleaseSupportFiles(packageRoot: string, sourceRoot = REPO_ROOT): Promise<void> {
  const files = await releaseFiles(sourceRoot);
  for (const file of files) {
    await mkdir(path.dirname(path.join(packageRoot, file)), { recursive: true });
    await cp(path.join(sourceRoot, file), path.join(packageRoot, file));
  }
  await mkdir(path.join(packageRoot, 'logs'), { recursive: true });
  await mkdir(path.join(packageRoot, 'data'), { recursive: true });
}

async function prepareGuiDist(root: string): Promise<void> {
  if (process.env.STREAM_SYNC_REUSE_GUI_DIST === 'true') {
    await releaseFiles(root);
    return;
  }

  await run('bun', ['run', 'build'], root);
  await releaseFiles(root);
}

export async function buildArtifact(target: ReleaseTarget, root = REPO_ROOT): Promise<void> {
  const config = TARGETS[target];
  const packageRoot = path.join(root, 'dist', 'release', config.packageDirectory);
  const executablePath = path.join(packageRoot, config.executableName);

  await prepareGuiDist(root);
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });

  await run('bun', [
    'build',
    path.join(root, 'src', 'bootstrap.ts'),
    '--compile',
    '--minify',
    `--target=${config.bunTarget}`,
    '--outfile',
    executablePath
  ], root);
  await copyReleaseSupportFiles(packageRoot, root);
  await validatePackage(packageRoot, target);
}

if (require.main === module) (async () => {
  if (process.argv[2] === '--verify') {
    const target = parseTarget(process.argv[3]);
    if (!process.argv[4]) throw new Error('Missing package directory');
    await validatePackage(path.resolve(process.argv[4]), target);
  } else await buildArtifact(parseTarget(process.argv[2]));
})().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Release artifact build failed: ${message}\n`);
  process.exit(1);
});
