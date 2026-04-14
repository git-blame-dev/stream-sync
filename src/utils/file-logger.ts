import defaultFs from 'node:fs';
import path from 'node:path';

type FileLoggerConfig = {
    logDir?: string;
    filename?: string;
};

type FileLoggerResolvedConfig = {
    logDir: string;
    filename?: string;
};

type FileLoggerFs = Pick<typeof defaultFs, 'appendFileSync' | 'existsSync' | 'mkdirSync'>;

type FileLoggerDependencies = {
    fs?: FileLoggerFs;
};

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class FileLogger {
    private readonly fs: FileLoggerFs;
    private readonly config: FileLoggerResolvedConfig;

    constructor(config: FileLoggerConfig = {}, deps: FileLoggerDependencies = {}) {
        if (!config.logDir) {
            throw new Error('logDir is required for FileLogger');
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
            process.stderr.write(`[FileLogger] Failed to write to ${fullPath}: ${message}\n`);
        }
    }

    log(content: string): void {
        const filename = this.config.filename ?? 'runtime.log';
        this.write(filename, content);
    }

    private ensureLogDirectory(): void {
        try {
            if (!this.fs.existsSync(this.config.logDir)) {
                this.fs.mkdirSync(this.config.logDir, { recursive: true });
            }
        } catch (error) {
            const message = toErrorMessage(error);
            process.stderr.write(`[FileLogger] Failed to create log directory: ${message}\n`);
        }
    }
}
