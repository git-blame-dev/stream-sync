import { describe, it, expect } from 'bun:test';
import { StreamElementsPlatform } from '../../../src/platforms/streamelements';
import { createRecordingLogger } from '../../helpers/recording-logger';

describe('StreamElementsPlatform message parsing', () => {
    it('reports invalid JSON without throwing or exposing parser input', () => {
        const logger = createRecordingLogger();
        const platform = new StreamElementsPlatform({ enabled: false }, { logger });
        expect(() => platform.handleMessage(Buffer.from('test-private-invalid-json'))).not.toThrow();
        expect(logger.entries.filter((entry) => entry.level === 'error')).toEqual([expect.objectContaining({ level: 'error' })]);
        const serialized = JSON.stringify(logger.entries);
        expect(serialized).toContain('Invalid StreamElements JSON frame');
        expect(serialized).not.toContain('test-private-invalid-json');
    });
});
