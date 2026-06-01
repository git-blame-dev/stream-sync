import defaultFs, { promises as defaultFsPromises } from 'node:fs';

type LogDirectoryOptions = { recursive: true };
type LogDirectoryExistsSync = (directoryPath: string) => boolean;
type LogDirectoryMkdirSync = (directoryPath: string, options: LogDirectoryOptions) => unknown;
type LogDirectoryMkdir = (directoryPath: string, options: LogDirectoryOptions) => Promise<unknown> | unknown;

type EnsureLogDirectorySyncDependencies = {
    existsSync?: LogDirectoryExistsSync;
    mkdirSync?: LogDirectoryMkdirSync;
    checkExists?: boolean;
};

type EnsureLogDirectoryDependencies = {
    mkdir?: LogDirectoryMkdir;
};

function ensureLogDirectorySync(
    directoryPath: string,
    dependencies: EnsureLogDirectorySyncDependencies = {}
): void {
    const existsSync = dependencies.existsSync ?? defaultFs.existsSync;
    const mkdirSync = dependencies.mkdirSync ?? defaultFs.mkdirSync;

    if (dependencies.checkExists !== false && existsSync(directoryPath)) {
        return;
    }

    mkdirSync(directoryPath, { recursive: true });
}

async function ensureLogDirectory(
    directoryPath: string,
    dependencies: EnsureLogDirectoryDependencies = {}
): Promise<void> {
    const mkdir = dependencies.mkdir ?? defaultFsPromises.mkdir;
    await mkdir(directoryPath, { recursive: true });
}

export {
    ensureLogDirectory,
    ensureLogDirectorySync
};

export type {
    EnsureLogDirectoryDependencies,
    EnsureLogDirectorySyncDependencies,
    LogDirectoryExistsSync,
    LogDirectoryMkdir,
    LogDirectoryMkdirSync,
    LogDirectoryOptions
};
