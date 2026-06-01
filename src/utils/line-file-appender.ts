import defaultFs from 'node:fs';
import path from 'node:path';
import { ensureLogDirectorySync } from './log-directory';

type LineFileAppenderConfig = {
    logDir?: string;
    filename?: string;
};

type LineFileAppenderResolvedConfig = {
    logDir: string;
    filename?: string;
};

type LineFileAppenderFs = Pick<typeof defaultFs, 'appendFileSync' | 'existsSync' | 'mkdirSync'>;

type LineFileAppenderDependencies = {
    fs?: LineFileAppenderFs;
};

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class LineFileAppender {
    private readonly fs: LineFileAppenderFs;
    private readonly config: LineFileAppenderResolvedConfig;

    constructor(config: LineFileAppenderConfig = {}, deps: LineFileAppenderDependencies = {}) {
        if (!config.logDir) {
            throw new Error('logDir is required for LineFileAppender');
        }

        this.fs = deps.fs ?? defaultFs;
        this.config = {
            ...config,
            logDir: config.logDir
        };

        this.ensureLogDirectory();
    }

    write(filename: string, content: string): void {
        const fullPath = path.join(this.config.logDir, filename);

        try {
            this.fs.appendFileSync(fullPath, `${content}\n`);
        } catch (error) {
            const message = toErrorMessage(error);
            process.stderr.write(`[LineFileAppender] Failed to write to ${fullPath}: ${message}\n`);
        }
    }

    log(content: string): void {
        const filename = this.config.filename ?? 'runtime.log';
        this.write(filename, content);
    }

    private ensureLogDirectory(): void {
        try {
            ensureLogDirectorySync(this.config.logDir, {
                existsSync: this.fs.existsSync,
                mkdirSync: this.fs.mkdirSync
            });
        } catch (error) {
            const message = toErrorMessage(error);
            process.stderr.write(`[LineFileAppender] Failed to create log directory: ${message}\n`);
        }
    }
}
