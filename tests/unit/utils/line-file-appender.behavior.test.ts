import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LineFileAppender } from '../../../src/utils/line-file-appender';
import { captureStderr } from '../../helpers/output-capture';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'synthetic-line-log-')); roots.push(root); return root; }

describe('line-file-appender behavior', () => {
    it('rejects portable unsafe filenames and keeps ordinary writes contained', async () => {
        const root = await directory(); const capture = captureStderr();
        try {
            const writer = new LineFileAppender({ logDir: root });
            for (const name of ['', '.', '..', '../outside', 'dir/file', 'dir\\file', '/absolute', 'C:drive', 'bad\0name', 'CON', 'NUL .txt', 'COM1.log', 'LPT²', 'CONIN$', 'bad?', 'bad*', 'bad<', 'bad>', 'bad"', 'bad|', 'trailing.', 'trailing ', 'bad\nname']) {
                expect(writer.write(name, 'synthetic record')).toBe(false);
            }
            expect(capture.output.every(message => message === '[LineFileAppender] Rejected unsafe log filename\n')).toBe(true);
            expect(writer.write('配信 café.log', 'unicode')).toBe(true);
            await writer.flush();
            expect(await readdir(root)).toEqual(['配信 café.log']);
            expect(await readFile(path.join(root, '配信 café.log'), 'utf8')).toBe('unicode\n');
        } finally { capture.restore(); }
    });
    it('rejects invalid configuration without filesystem changes', () => {
        expect(() => new LineFileAppender()).toThrow('logDir is required');
        for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
            expect(() => new LineFileAppender({ logDir: 'unused', maxBytes: value })).toThrow('positive safe integers');
        }
    });
    it('contains filesystem failures and recovers on a different destination', async () => {
        const root = await directory(); const blocked = path.join(root, 'file');
        await writeFile(blocked, 'synthetic obstruction'); const capture = captureStderr();
        try {
            const writer = new LineFileAppender({ logDir: blocked }); writer.log('cannot write'); await writer.flush();
            expect(capture.output.join('')).toContain('File write failed');
            writer.reconfigure({ logDir: path.join(root, 'recovered') }); writer.log('recovered'); await writer.flush();
            expect(await readFile(path.join(root, 'recovered/runtime.log'), 'utf8')).toBe('recovered\n');
            expect(await readFile(blocked, 'utf8')).toBe('synthetic obstruction');
        } finally { capture.restore(); }
    });
});
