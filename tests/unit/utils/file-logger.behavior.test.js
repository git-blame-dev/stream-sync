const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { FileLogger } = require('../../../src/utils/file-logger');

function createMockFs() {
    const files = {};
    const dirs = new Set();

    return {
        _files: files,
        _dirs: dirs,
        existsSync: createMockFn((target) => dirs.has(target) || Object.prototype.hasOwnProperty.call(files, target)),
        mkdirSync: createMockFn((dir) => { dirs.add(dir); }),
        appendFileSync: createMockFn((file, content) => { files[file] = (files[file] || '') + content; }),
        statSync: createMockFn((file) => ({ size: (files[file] || '').length })),
        renameSync: createMockFn((oldPath, newPath) => {
            files[newPath] = files[oldPath] || '';
            delete files[oldPath];
        }),
        unlinkSync: createMockFn((target) => { delete files[target]; })
    };
}

describe('file-logger behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('requires a log directory for construction', () => {
        expect(() => new FileLogger()).toThrow('logDir is required');
    });

    it('ensures log directory exists on construction', () => {
        const mockFs = createMockFs();

        new FileLogger({ logDir: 'logs-test' }, { fs: mockFs });

        expect(mockFs.mkdirSync).toHaveBeenCalledWith('logs-test', { recursive: true });
    });

    it('writes log content to the configured file', () => {
        const mockFs = createMockFs();

        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log' }, { fs: mockFs });

        logger.log('new-line');

        expect(mockFs.appendFileSync).toHaveBeenCalledWith('logs/app.log', 'new-line\n');
    });

    it('writes error to stderr when append fails', () => {
        const mockFs = createMockFs();
        mockFs.appendFileSync.mockImplementation(() => { throw new Error('disk full'); });
        const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => {});

        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log' }, { fs: mockFs });
        logger.log('entry');

        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to write'));
        stderrSpy.mockRestore();
    });
});
