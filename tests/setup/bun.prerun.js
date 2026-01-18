process.env.NODE_ENV = 'test';

const originalProcessExit = process.exit;

function noopProcessExit(code = 0) {
    noopProcessExit.calls.push(code);
}

noopProcessExit.calls = [];

process.exit = noopProcessExit;

global.__ORIGINAL_PROCESS_EXIT__ = originalProcessExit;
global.__NOOP_PROCESS_EXIT__ = noopProcessExit;

const originalStderrWrite = process.stderr.write.bind(process.stderr);
const stderrCapture = [];

process.stderr.write = (chunk, encoding, callback) => {
    stderrCapture.push(chunk);
    if (typeof callback === 'function') callback();
    return true;
};

global.__ORIGINAL_STDERR_WRITE__ = originalStderrWrite;
global.__STDERR_CAPTURE__ = stderrCapture;
