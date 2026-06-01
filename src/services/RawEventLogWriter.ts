import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ensureLogDirectory } from '../utils/log-directory';
import { getSystemTimestampISO } from '../utils/timestamp';

type RawEventLogWriterOptions = {
    dataLoggingPath: string;
    platform: string;
    eventType: string;
    payload: unknown;
};

type RawEventLogWriteResult = {
    filePath: string;
    fileName: string;
};

class RawEventLogWriter {
    async writeRawEvent(options: RawEventLogWriterOptions): Promise<RawEventLogWriteResult> {
        const fileName = this.resolveLogFileName(options.platform, options.eventType);
        const filePath = path.join(options.dataLoggingPath, fileName);
        const logEntry = {
            ingestTimestamp: getSystemTimestampISO(),
            platform: options.platform,
            eventType: options.eventType,
            payload: options.payload
        };

        await ensureLogDirectory(options.dataLoggingPath);
        await fs.appendFile(filePath, `${JSON.stringify(logEntry)}\n`, 'utf8');

        return { filePath, fileName };
    }

    resolveLogFileName(platform: string, eventType: string): string {
        if (platform === 'youtube' && eventType === 'unknown-renderer') {
            return 'youtube-unknown-renderer-log.ndjson';
        }

        return `${platform}-data-log.ndjson`;
    }
}

export { RawEventLogWriter, type RawEventLogWriteResult, type RawEventLogWriterOptions };
