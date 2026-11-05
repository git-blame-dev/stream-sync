import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { OPERATOR_CONTROL_KEYS, type OperatorControlKey, type OperatorControls, type OperatorConfigState } from '../../core/operator-control-contract';
import { ViewerOutputPolicy } from '../../core/viewer-output-policy';

const operatorControlKeys = new Set<string>(OPERATOR_CONTROL_KEYS);

type OperatorControlSnapshot = Readonly<{
    controls: OperatorControls;
    configStates?: Readonly<Partial<Record<OperatorControlKey, OperatorConfigState>>>;
    overriddenKeys: readonly OperatorControlKey[];
    sessionId?: string;
    revision: number;
}>;
type FileSystem = {
    readFile: (path: string, encoding: 'utf8') => Promise<string>;
    mkdir: (path: string, options: { recursive: true; mode?: number }) => Promise<unknown>;
    writeFile: (path: string, data: string, options: { encoding: 'utf8'; mode?: number }) => Promise<unknown>;
    rename: (from: string, to: string) => Promise<void>;
    unlink: (path: string) => Promise<void>;
};
type OperatorControlOptions = {
    defaults: OperatorControls;
    platformConfig?: ConstructorParameters<typeof ViewerOutputPolicy>[0];
    filePath?: string;
    fs?: FileSystem;
    warn?: (message: string) => void;
};

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function assertControlKey(key: unknown): asserts key is OperatorControlKey {
    if (typeof key !== 'string' || !operatorControlKeys.has(key)) {
        throw new RangeError(`Unknown operator control key: ${String(key)}`);
    }
}

class OperatorControlService {
    readonly outputPolicy: ViewerOutputPolicy | undefined;
    private readonly defaults: OperatorControls;
    private readonly filePath: string;
    private readonly fs: FileSystem;
    private readonly warn: (message: string) => void;
    private overrides = new Map<OperatorControlKey, boolean>();
    private values: OperatorControls;
    private listeners = new Set<(snapshot: OperatorControlSnapshot) => void>();
    readonly sessionId = randomUUID();
    private currentRevision = 0;
    private tempSequence = 0;
    private operation: Promise<void> = Promise.resolve();

    private constructor(options: OperatorControlOptions) {
        this.defaults = { ...options.defaults };
        this.values = { ...this.defaults };
        this.outputPolicy = options.platformConfig ? new ViewerOutputPolicy(options.platformConfig, key => this.overrides.get(key)) : undefined;
        this.filePath = options.filePath ?? './data/operator-control-overrides.json';
        this.fs = options.fs ?? { readFile, mkdir, writeFile, rename, unlink };
        this.warn = options.warn ?? (() => undefined);
    }

    static async create(options: OperatorControlOptions): Promise<OperatorControlService> {
        const service = new OperatorControlService(options);
        await service.load();
        return service;
    }

    get configStates() {
        return this.outputPolicy?.configStates;
    }

    get controls(): OperatorControls {
        return { ...this.values };
    }

    get overriddenKeys(): OperatorControlKey[] {
        return [...this.overrides.keys()];
    }

    get revision(): number {
        return this.currentRevision;
    }

    isEnabled(key: OperatorControlKey): boolean {
        assertControlKey(key);
        return this.values[key];
    }

    subscribe(listener: (snapshot: OperatorControlSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async setEnabled(key: OperatorControlKey, enabled: boolean): Promise<void> {
        assertControlKey(key);
        if (typeof enabled !== 'boolean') {
            throw new TypeError('enabled must be a boolean');
        }
        return this.enqueue(async () => {
            const next = new Map(this.overrides);
            next.set(key, enabled);
            await this.persist(next);
            this.overrides = next;
            this.values = this.withOverrides(next);
            this.notify();
        });
    }

    async reset(): Promise<void> {
        return this.enqueue(async () => {
            const next = new Map<OperatorControlKey, boolean>();
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
                this.warn('Unable to read operator control overrides; using config defaults');
            }
            return;
        }

        try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new TypeError('Expected an object');
            }
            const next = new Map<OperatorControlKey, boolean>();
            for (const [key, value] of Object.entries(parsed)) {
                assertControlKey(key);
                if (typeof value !== 'boolean') {
                    throw new TypeError(`Expected boolean override for ${key}`);
                }
                next.set(key, value);
            }
            this.overrides = next;
            this.values = this.withOverrides(next);
        } catch {
            this.warn('Malformed operator control overrides; using config defaults');
        }
    }

    private withOverrides(overrides: Map<OperatorControlKey, boolean>): OperatorControls {
        const values = { ...this.defaults };
        for (const [key, value] of overrides) {
            values[key] = value;
        }
        return values;
    }

    private async persist(overrides: Map<OperatorControlKey, boolean>): Promise<void> {
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

    private notify(): void {
        this.currentRevision += 1;
        const snapshot = Object.freeze({
            controls: Object.freeze(this.controls),
            ...(this.configStates ? { configStates: this.configStates } : {}),
            overriddenKeys: Object.freeze(this.overriddenKeys),
            sessionId: this.sessionId,
            revision: this.revision
        });
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // A failed listener cannot roll back a persisted update.
            }
        }
    }
}

const createOperatorControlService = OperatorControlService.create;

export {
    createOperatorControlService,
    OPERATOR_CONTROL_KEYS,
    OperatorControlService
};
export type {
    OperatorControlKey,
    OperatorControlOptions,
    OperatorControls,
    OperatorControlSnapshot
};
