jest.mock('fs', () => {
    const mockState = { files: {}, dirs: new Set() };

    return {
        __state: mockState,
        existsSync: jest.fn((target) => {
            if (mockState.dirs.has(target)) return true;
            return Object.prototype.hasOwnProperty.call(mockState.files, target);
        }),
        mkdirSync: jest.fn((dir) => { mockState.dirs.add(dir); }),
        appendFileSync: jest.fn((file, content) => { mockState.files[file] = (mockState.files[file] || '') + content; }),
        statSync: jest.fn((file) => ({ size: (mockState.files[file] || '').length })),
        renameSync: jest.fn((oldPath, newPath) => {
            mockState.files[newPath] = mockState.files[oldPath] || '';
            delete mockState.files[oldPath];
        }),
        unlinkSync: jest.fn((target) => { delete mockState.files[target]; })
    };
});

const fs = require('fs');
const { FileLogger } = require('../../../src/utils/file-logger');

describe('file-logger behavior', () => {
    const resetFsState = () => {
        fs.__state.files = {};
        fs.__state.dirs = new Set();
        jest.clearAllMocks();
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
        const rotationSpy = jest.spyOn(FileLogger.prototype, 'needsRotation').mockReturnValue(true);
        const rotateFileSpy = jest.spyOn(FileLogger.prototype, 'rotateFile');
        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log', maxSize: 10, maxFiles: 2 });

        logger.log('new-line');

        expect(rotateFileSpy).toHaveBeenCalledWith('logs/app.log');
        expect(fs.appendFileSync).toHaveBeenCalledWith('logs/app.log', 'new-line\n');
        rotationSpy.mockRestore();
        rotateFileSpy.mockRestore();
    });

    it('writes error to stderr when append fails', () => {
        fs.appendFileSync.mockImplementation(() => { throw new Error('disk full'); });
        const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
        const logger = new FileLogger({ logDir: 'logs', filename: 'app.log' });

        logger.log('entry');

        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to write'));
        stderrSpy.mockRestore();
    });
});
