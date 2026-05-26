import { spawn } from 'node:child_process';
import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

type ReleaseTarget = 'linux-x64' | 'windows-x64';

interface TargetConfig {
  readonly bunTarget: string;
  readonly packageDirectory: string;
  readonly executableName: string;
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const RELEASE_ROOT = path.join(REPO_ROOT, 'dist', 'release');
const ENTRYPOINT = path.join(REPO_ROOT, 'src', 'bootstrap.ts');
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

function parseTarget(value: string | undefined): ReleaseTarget {
  if (value === 'linux-x64' || value === 'windows-x64') {
    return value;
  }

  throw new Error('Usage: bun scripts/release/build-artifact.ts <linux-x64|windows-x64>');
}

function repoPath(...segments: readonly string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: REPO_ROOT,
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

async function copyReleaseSupportFiles(packageRoot: string): Promise<void> {
  await cp(repoPath('config.example.ini'), path.join(packageRoot, 'config.example.ini'));
  await cp(repoPath('.env.example'), path.join(packageRoot, '.env.example'));
  await cp(repoPath('README.md'), path.join(packageRoot, 'README.md'));
  await cp(repoPath('gui', 'dist'), path.join(packageRoot, 'gui', 'dist'), { recursive: true });
  await mkdir(path.join(packageRoot, 'logs'), { recursive: true });
  await mkdir(path.join(packageRoot, 'data'), { recursive: true });
}

async function prepareGuiDist(): Promise<void> {
  if (process.env.STREAM_SYNC_REUSE_GUI_DIST === 'true') {
    await access(repoPath('gui', 'dist', 'assets', 'dock.js'));
    return;
  }

  await run('bun', ['run', 'build']);
}

async function buildArtifact(target: ReleaseTarget): Promise<void> {
  const config = TARGETS[target];
  const packageRoot = path.join(RELEASE_ROOT, config.packageDirectory);
  const executablePath = path.join(packageRoot, config.executableName);

  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });

  await prepareGuiDist();
  await run('bun', [
    'build',
    ENTRYPOINT,
    '--compile',
    '--minify',
    `--target=${config.bunTarget}`,
    '--outfile',
    executablePath
  ]);
  await copyReleaseSupportFiles(packageRoot);
}

buildArtifact(parseTarget(process.argv[2])).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Release artifact build failed: ${message}\n`);
  process.exit(1);
});
