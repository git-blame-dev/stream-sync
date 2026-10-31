import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);
const ini = nodeRequire('ini') as {
    stringify: (value: Record<string, unknown>) => string;
};
const { getRawTestConfig } = nodeRequire('../helpers/config-fixture') as {
    getRawTestConfig: () => Record<string, unknown>;
};

process.env.NODE_ENV = 'test';

const tempConfigDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-sync-test-config-'));
const tempConfigPath = path.join(tempConfigDirectory, 'config.ini');
fs.writeFileSync(tempConfigPath, ini.stringify(getRawTestConfig()));
process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
process.once('exit', () => fs.rmSync(tempConfigDirectory, { recursive: true, force: true }));

type WriteCallback = (error?: Error | null) => void;
type WriteFunction = typeof process.stdout.write;
type PreRunGlobalState = typeof globalThis & {
    __ORIGINAL_PROCESS_EXIT__: typeof process.exit;
    __NOOP_PROCESS_EXIT__: typeof process.exit;
    __ORIGINAL_STDOUT_WRITE__: WriteFunction;
    __SUPPRESSED_STDOUT_WRITE__: WriteFunction;
    __ORIGINAL_STDERR_WRITE__: WriteFunction;
    __SUPPRESSED_STDERR_WRITE__: WriteFunction;
};

const originalProcessExit = process.exit;
const preRunGlobal = global as PreRunGlobalState;

// Imports and shutdown tests can exit in-process; callers capture exit attempts locally.
const noopProcessExit = (() => {}) as typeof process.exit;

process.exit = noopProcessExit;

preRunGlobal.__ORIGINAL_PROCESS_EXIT__ = originalProcessExit;
preRunGlobal.__NOOP_PROCESS_EXIT__ = noopProcessExit;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const suppressedStdoutWrite = ((_chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback) => {
    const writeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    writeCallback?.();
    return true;
}) as typeof process.stdout.write;

const suppressedStderrWrite = ((_chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback) => {
    const writeCallback = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    writeCallback?.();
    return true;
}) as typeof process.stderr.write;

process.stdout.write = suppressedStdoutWrite;
process.stderr.write = suppressedStderrWrite;

preRunGlobal.__ORIGINAL_STDOUT_WRITE__ = originalStdoutWrite;
preRunGlobal.__SUPPRESSED_STDOUT_WRITE__ = suppressedStdoutWrite;
preRunGlobal.__ORIGINAL_STDERR_WRITE__ = originalStderrWrite;
preRunGlobal.__SUPPRESSED_STDERR_WRITE__ = suppressedStderrWrite;
