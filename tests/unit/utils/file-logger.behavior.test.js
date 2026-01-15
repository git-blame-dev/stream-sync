const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('fs', () => {
    const mockState = { files: {}, dirs: new Set() };

    return {
        __state: mockState,
        existsSync: createMockFn((target) => {
            if (mockState.dirs.has(target)) return true;
            return Object.prototype.hasOwnProperty.call(mockState.files, target);
        }),
        mkdirSync: createMockFn((dir) => { mockState.dirs.add(dir); }),
        appendFileSync: createMockFn((file, content) => { mockState.files[file] = (mockState.files[file] || '') + content; }),
        statSync: createMockFn((file) => ({ size: (mockState.files[file] || '').length })),
        renameSync: createMockFn((oldPath, newPath) => {
            mockState.files[newPath] = mockState.files[oldPath] || '';
            delete mockState.files[oldPath];
        }),
        unlinkSync: createMockFn((target) => { delete mockState.files[target]; })
    };
});

const fs = require('fs');
const { FileLogger } = require('../../../src/utils/file-logger');

describe('file-logger behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const resetFsState = () => {
        fs.__state.files = {};
        fs.__state.dirs = new Set();
        clearAllMocks();
    };

    beforeEach(() => resetFsState());

    it('requires a log directory for construction', () => {
        expect(() => new FileLogger()).toThrow('logDir is required');
    });

    it('ensures log directory exists on construction', () => {
        new FileLogger({ logDir: 'logs-test' });

        expect(fs.mkdirSync).toHaveBeenCalledWith('logs-test', { recursive: true });
    });

    it('writes log content and rotates when exceeding max size', () => {
        fs.__state.files['logs/app.log'] = 'x'.repeat(15);
        const rotationSpy = spyOn(FileLogger.prototype, 'needsRotation').mockReturnValue(true);
        const rotateFileSpy = spyOn(FileLogger.prototype, 'rotateFile');
        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log', maxSize: 10, maxFiles: 2 });

        logger.log('new-line');

        expect(rotateFileSpy).toHaveBeenCalledWith('logs/app.log');
        expect(fs.appendFileSync).toHaveBeenCalledWith('logs/app.log', 'new-line\n');
        rotationSpy.mockRestore();
        rotateFileSpy.mockRestore();
    });

    it('writes error to stderr when append fails', () => {
        fs.appendFileSync.mockImplementation(() => { throw new Error('disk full'); });
        const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => {});
        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log' });

        logger.log('entry');

        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to write'));
        stderrSpy.mockRestore();
    });
});
