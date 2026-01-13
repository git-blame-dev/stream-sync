// Preserve original process.exit and replace it with a safe stub to prevent
// worker shutdowns triggered by modules that call process.exit during import.
const originalProcessExit = process.exit;

function noopProcessExit(code = 0) {
    noopProcessExit.calls.push(code);
}

noopProcessExit.calls = [];

process.exit = noopProcessExit;

// Expose original reference so setup can restore it
global.__ORIGINAL_PROCESS_EXIT__ = originalProcessExit;
global.__NOOP_PROCESS_EXIT__ = noopProcessExit;
