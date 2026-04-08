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

const tempConfigPath = path.join(os.tmpdir(), 'stream-sync-test-config.ini');
fs.writeFileSync(tempConfigPath, ini.stringify(getRawTestConfig()));
process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;

type ProcessExitCode = Parameters<typeof process.exit>[0];
type NoopProcessExit = typeof process.exit & { calls: ProcessExitCode[] };
type WriteCallback = (error?: Error | null) => void;
type WriteFunction = typeof process.stdout.write;
type PreRunGlobalState = typeof globalThis & {
    __ORIGINAL_PROCESS_EXIT__: typeof process.exit;
    __NOOP_PROCESS_EXIT__: NoopProcessExit;
    __ORIGINAL_STDOUT_WRITE__: WriteFunction;
    __SUPPRESSED_STDOUT_WRITE__: WriteFunction;
    __ORIGINAL_STDERR_WRITE__: WriteFunction;
    __SUPPRESSED_STDERR_WRITE__: WriteFunction;
};

const originalProcessExit = process.exit;
const preRunGlobal = global as PreRunGlobalState;

const noopProcessExit = ((code = 0) => {
    noopProcessExit.calls.push(code);
}) as NoopProcessExit;

noopProcessExit.calls = [];

process.exit = noopProcessExit;

preRunGlobal.__ORIGINAL_PROCESS_EXIT__ = originalProcessExit;
preRunGlobal.__NOOP_PROCESS_EXIT__ = noopProcessExit;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const suppressedStdoutWrite = ((_chunk: string | Uint8Array, _encoding?: BufferEncoding, callback?: WriteCallback) => {
    if (typeof callback === 'function') callback();
    return true;
}) as typeof process.stdout.write;

const suppressedStderrWrite = ((_chunk: string | Uint8Array, _encoding?: BufferEncoding, callback?: WriteCallback) => {
    if (typeof callback === 'function') callback();
    return true;
}) as typeof process.stderr.write;

process.stdout.write = suppressedStdoutWrite;
process.stderr.write = suppressedStderrWrite;

preRunGlobal.__ORIGINAL_STDOUT_WRITE__ = originalStdoutWrite;
preRunGlobal.__SUPPRESSED_STDOUT_WRITE__ = suppressedStdoutWrite;
preRunGlobal.__ORIGINAL_STDERR_WRITE__ = originalStderrWrite;
preRunGlobal.__SUPPRESSED_STDERR_WRITE__ = suppressedStderrWrite;
