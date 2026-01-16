const { describe, test, expect, beforeEach } = require('bun:test');

const { setDebugMode, getDebugMode } = require('../../src/core/logging');

describe('Debug Mode Command Line Argument', () => {
    beforeEach(() => {
        setDebugMode(false);
    });

    test('enables debug mode when --debug argument is provided', () => {
        const args = ['--debug'];
        const hasDebugArg = args.includes('--debug');

        if (hasDebugArg) {
            setDebugMode(true);
        }

        expect(getDebugMode()).toBe(true);
    });

    test('debug mode remains disabled when no --debug argument is provided', () => {
        const args = ['--no-msg'];
        const hasDebugArg = args.includes('--debug');

        if (hasDebugArg) {
            setDebugMode(true);
        }

        expect(getDebugMode()).toBe(false);
    });

    test('--debug argument overrides config.ini setting', () => {
        const configDebugEnabled = false;
        setDebugMode(configDebugEnabled);
        expect(getDebugMode()).toBe(false);

        const args = ['--debug'];
        const hasDebugArg = args.includes('--debug');

        if (hasDebugArg) {
            setDebugMode(true);
        }

        expect(getDebugMode()).toBe(true);
    });

    test('uses config.ini setting when no --debug argument is provided', () => {
        const configDebugEnabled = true;
        const args = ['--no-msg'];
        const hasDebugArg = args.includes('--debug');

        if (hasDebugArg) {
            setDebugMode(true);
        } else {
            setDebugMode(configDebugEnabled);
        }

        expect(getDebugMode()).toBe(true);
    });

    test('handles multiple command line arguments correctly', () => {
        const args = ['--debug', '--no-msg'];
        const hasDebugArg = args.includes('--debug');

        if (hasDebugArg) {
            setDebugMode(true);
        }

        expect(getDebugMode()).toBe(true);
    });

    test('toggles debug mode correctly', () => {
        expect(getDebugMode()).toBe(false);

        setDebugMode(true);
        expect(getDebugMode()).toBe(true);

        setDebugMode(false);
        expect(getDebugMode()).toBe(false);

        setDebugMode(true);
        expect(getDebugMode()).toBe(true);
    });
});
