import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OPERATOR_APPEARANCE_KEYS = [
    'compactRows',
    'rowBackgroundsEnabled',
    'maxDisplayableBadges'
] as const;
const operatorAppearanceKeys = new Set<string>(OPERATOR_APPEARANCE_KEYS);

type OperatorAppearanceKey = (typeof OPERATOR_APPEARANCE_KEYS)[number];
type OperatorAppearanceSettings = Readonly<{
    compactRows: boolean;
    rowBackgroundsEnabled: boolean;
    maxDisplayableBadges: number;
}>;
type OperatorAppearanceSnapshot = Readonly<{
    revision: number;
    settings: OperatorAppearanceSettings;
    overriddenKeys: readonly OperatorAppearanceKey[];
}>;
type FileSystem = {
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
    mkdir: (path: string, options: { recursive: true; mode?: number }) => Promise<unknown>;
    writeFile: (path: string, data: string, options: { encoding: 'utf8'; mode?: number }) => Promise<unknown>;
    rename: (from: string, to: string) => Promise<void>;
    unlink: (path: string) => Promise<void>;
};
type OperatorAppearanceOptions = {
    defaults: OperatorAppearanceSettings;
    filePath?: string;
    fs?: FileSystem;
    warn?: (message: string) => void;
};

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function assertAppearanceKey(key: unknown): asserts key is OperatorAppearanceKey {
    if (typeof key !== 'string' || !operatorAppearanceKeys.has(key)) {
        throw new RangeError(`Unknown operator appearance key: ${String(key)}`);
    }
}

function assertAppearanceValue(key: OperatorAppearanceKey, value: unknown): void {
    if (key === 'maxDisplayableBadges') {
        if (!Number.isSafeInteger(value) || Number(value) < 0) {
            throw new TypeError('maxDisplayableBadges must be a non-negative safe integer');
        }
        return;
    }
    if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
    }
}

class OperatorAppearanceService {
    private readonly defaults: OperatorAppearanceSettings;
    private readonly filePath: string;
    private readonly fs: FileSystem;
    private readonly warn: (message: string) => void;
    private overrides = new Map<OperatorAppearanceKey, boolean | number>();
    private values: OperatorAppearanceSettings;
    private listeners = new Set<(snapshot: OperatorAppearanceSnapshot) => void>();
    private currentRevision = 0;
    private tempSequence = 0;
    private operation: Promise<void> = Promise.resolve();

    private constructor(options: OperatorAppearanceOptions) {
        this.defaults = { ...options.defaults };
        this.values = { ...this.defaults };
        this.filePath = options.filePath ?? './data/operator-appearance-overrides.json';
        this.fs = options.fs ?? { readFile, mkdir, writeFile, rename, unlink };
        this.warn = options.warn ?? (() => undefined);
    }

    static async create(options: OperatorAppearanceOptions): Promise<OperatorAppearanceService> {
        const service = new OperatorAppearanceService(options);
        await service.load();
        return service;
    }

    get settings(): OperatorAppearanceSettings {
        return { ...this.values };
    }

    get overriddenKeys(): OperatorAppearanceKey[] {
        return [...this.overrides.keys()];
    }

    get revision(): number {
        return this.currentRevision;
    }

    get snapshot(): OperatorAppearanceSnapshot {
        return this.createSnapshot();
    }

    subscribe(listener: (snapshot: OperatorAppearanceSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async set(key: OperatorAppearanceKey, value: boolean | number): Promise<void> {
        assertAppearanceKey(key);
        assertAppearanceValue(key, value);
        return this.enqueue(async () => {
            const next = new Map(this.overrides);
            if (value === this.defaults[key]) {
                next.delete(key);
            } else {
                next.set(key, value);
            }
            await this.persist(next);
            this.overrides = next;
            this.values = this.withOverrides(next);
            this.notify();
        });
    }

    async reset(): Promise<void> {
        return this.enqueue(async () => {
            const next = new Map<OperatorAppearanceKey, boolean | number>();
            await this.persist(next);
            this.overrides = next;
            this.values = { ...this.defaults };
            this.notify();
        });
    }

    private async load(): Promise<void> {
        let text: string;
        try {
            text = await this.fs.readFile(this.filePath, 'utf8');
        } catch (error) {
            if (!isMissingFileError(error)) {
                this.warn('Unable to read operator appearance overrides; using config defaults');
            }
            return;
        }

        try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new TypeError('Expected an object');
            }
            const next = new Map<OperatorAppearanceKey, boolean | number>();
            for (const [key, value] of Object.entries(parsed)) {
                assertAppearanceKey(key);
                assertAppearanceValue(key, value);
                if (value !== this.defaults[key]) next.set(key, value as boolean | number);
            }
            this.overrides = next;
            this.values = this.withOverrides(next);
        } catch {
            this.warn('Malformed operator appearance overrides; using config defaults');
        }
    }

    private withOverrides(overrides: Map<OperatorAppearanceKey, boolean | number>): OperatorAppearanceSettings {
        const values = { ...this.defaults };
        for (const [key, value] of overrides) {
            if (key === 'maxDisplayableBadges') values.maxDisplayableBadges = value as number;
            else values[key] = value as boolean;
        }
        return values;
    }

    private async persist(overrides: Map<OperatorAppearanceKey, boolean | number>): Promise<void> {
        const tempPath = `${this.filePath}.tmp-${process.pid}-${++this.tempSequence}`;
        try {
            await this.fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
            await this.fs.writeFile(
                tempPath,
                `${JSON.stringify(Object.fromEntries(overrides), null, 2)}\n`,
                { encoding: 'utf8', mode: 0o600 }
            );
            await this.fs.rename(tempPath, this.filePath);
        } catch (error) {
            try {
                await this.fs.unlink(tempPath);
            } catch {
                // The temporary file may not have been created.
            }
            throw error;
        }
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const result = this.operation.then(task, task);
        this.operation = result.catch(() => undefined);
        return result;
    }

    private createSnapshot(): OperatorAppearanceSnapshot {
        return Object.freeze({
            revision: this.revision,
            settings: Object.freeze(this.settings),
            overriddenKeys: Object.freeze(this.overriddenKeys)
        });
    }

    private notify(): void {
        this.currentRevision += 1;
        const snapshot = this.createSnapshot();
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // A failed listener cannot roll back a persisted update.
            }
        }
    }
}

const createOperatorAppearanceService = OperatorAppearanceService.create;

export {
    createOperatorAppearanceService,
    OPERATOR_APPEARANCE_KEYS,
    OperatorAppearanceService
};
export type {
    OperatorAppearanceKey,
    OperatorAppearanceOptions,
    OperatorAppearanceSettings,
    OperatorAppearanceSnapshot
};
