process.env.NODE_ENV = 'test';

const os = require('os');
const fs = require('fs');
const path = require('path');
const ini = require('ini');
const { getRawTestConfig } = require('../helpers/config-fixture');

const tempConfigPath = path.join(os.tmpdir(), 'stream-sync-test-config.ini');
fs.writeFileSync(tempConfigPath, ini.stringify(getRawTestConfig()));
process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;

const originalProcessExit = process.exit;

function noopProcessExit(code = 0) {
    noopProcessExit.calls.push(code);
}

noopProcessExit.calls = [];

process.exit = noopProcessExit;

global.__ORIGINAL_PROCESS_EXIT__ = originalProcessExit;
global.__NOOP_PROCESS_EXIT__ = noopProcessExit;

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

const suppressedStdoutWrite = (chunk, encoding, callback) => {
    if (typeof callback === 'function') callback();
    return true;
};

const suppressedStderrWrite = (chunk, encoding, callback) => {
    if (typeof callback === 'function') callback();
    return true;
};

process.stdout.write = suppressedStdoutWrite;
process.stderr.write = suppressedStderrWrite;

global.__ORIGINAL_STDOUT_WRITE__ = originalStdoutWrite;
global.__SUPPRESSED_STDOUT_WRITE__ = suppressedStdoutWrite;
global.__ORIGINAL_STDERR_WRITE__ = originalStderrWrite;
global.__SUPPRESSED_STDERR_WRITE__ = suppressedStderrWrite;
