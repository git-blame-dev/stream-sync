import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
    isRowTheme,
    isRowVisualEffectId,
    type RowTheme,
    type RowVisualEffectId
} from '../../core/row-presentation';

const OPERATOR_APPEARANCE_KEYS = [
    'compactRows',
    'rowBackgroundsEnabled',
    'maxDisplayableBadges',
    'streamSupporterChatEffectsEnabled',
    'memberRowTheme',
    'memberRowEffects'
] as const;
const operatorAppearanceKeys = new Set<string>(OPERATOR_APPEARANCE_KEYS);

type OperatorAppearanceKey = (typeof OPERATOR_APPEARANCE_KEYS)[number];
type OperatorAppearanceSettings = Readonly<{
    compactRows: boolean;
    rowBackgroundsEnabled: boolean;
    maxDisplayableBadges: number;
    streamSupporterChatEffectsEnabled: boolean;
    memberRowTheme: RowTheme;
    memberRowEffects: readonly RowVisualEffectId[];
}>;
type OperatorAppearanceSnapshot = Readonly<{
    sessionId?: string;
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
    defaults: Omit<OperatorAppearanceSettings, 'streamSupporterChatEffectsEnabled' | 'memberRowTheme' | 'memberRowEffects'>
        & Partial<Pick<OperatorAppearanceSettings, 'streamSupporterChatEffectsEnabled' | 'memberRowTheme' | 'memberRowEffects'>>;
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
    if (key === 'memberRowTheme') {
        if (!isRowTheme(value)) throw new TypeError('memberRowTheme must be green, red, or gold');
        return;
    }
    if (key === 'memberRowEffects') {
        if (!Array.isArray(value) || value.length > 2 || new Set(value).size !== value.length || value.some((effect) => !isRowVisualEffectId(effect))) {
            throw new TypeError('memberRowEffects must contain unique known effects');
        }
        return;
    }
    if (typeof value !== 'boolean') {
        throw new TypeError(`${key} must be a boolean`);
    }
}

function sameEffects(left: unknown, right: unknown): boolean {
    return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length && left.every((effect, index) => effect === right[index]);
}

class OperatorAppearanceService {
    private readonly defaults: OperatorAppearanceSettings;
    private readonly filePath: string;
    private readonly fs: FileSystem;
    private readonly warn: (message: string) => void;
    private overrides = new Map<OperatorAppearanceKey, boolean | number | RowTheme | readonly RowVisualEffectId[]>();
    private values: OperatorAppearanceSettings;
    private listeners = new Set<(snapshot: OperatorAppearanceSnapshot) => void>();
    readonly sessionId = randomUUID();
    private currentRevision = 0;
    private tempSequence = 0;
    private operation: Promise<void> = Promise.resolve();

    private constructor(options: OperatorAppearanceOptions) {
        this.defaults = {
            ...options.defaults,
            streamSupporterChatEffectsEnabled: options.defaults.streamSupporterChatEffectsEnabled ?? true,
            memberRowTheme: options.defaults.memberRowTheme ?? 'green',
            memberRowEffects: [...options.defaults.memberRowEffects ?? ['sheen']]
        };
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
        return { ...this.values, memberRowEffects: [...this.values.memberRowEffects] };
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

    async set(key: OperatorAppearanceKey, value: boolean | number | RowTheme | readonly RowVisualEffectId[]): Promise<void> {
        assertAppearanceKey(key);
        assertAppearanceValue(key, value);
        return this.enqueue(async () => {
            const next = new Map(this.overrides);
            if (key === 'memberRowEffects' ? sameEffects(value, this.defaults.memberRowEffects) : value === this.defaults[key]) {
                next.delete(key);
            } else {
                next.set(key, key === 'memberRowEffects' ? [...value as readonly RowVisualEffectId[]] : value);
            }
            await this.persist(next);
            this.overrides = next;
            this.values = this.withOverrides(next);
            this.notify();
        });
    }

    async reset(): Promise<void> {
        return this.enqueue(async () => {
            const next = new Map<OperatorAppearanceKey, boolean | number | RowTheme | readonly RowVisualEffectId[]>();
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
            const next = new Map<OperatorAppearanceKey, boolean | number | RowTheme | readonly RowVisualEffectId[]>();
            for (const [key, value] of Object.entries(parsed)) {
                assertAppearanceKey(key);
                assertAppearanceValue(key, value);
                const matchesDefault = key === 'memberRowEffects'
                    ? sameEffects(value, this.defaults.memberRowEffects)
                    : value === this.defaults[key];
                if (!matchesDefault) {
                    next.set(key, key === 'memberRowEffects'
                        ? [...value as readonly RowVisualEffectId[]]
                        : value as boolean | number | RowTheme);
                }
            }
            this.overrides = next;
            this.values = this.withOverrides(next);
        } catch {
            this.warn('Malformed operator appearance overrides; using config defaults');
        }
    }

    private withOverrides(overrides: Map<OperatorAppearanceKey, boolean | number | RowTheme | readonly RowVisualEffectId[]>): OperatorAppearanceSettings {
        const values = { ...this.defaults };
        for (const [key, value] of overrides) {
            if (key === 'maxDisplayableBadges') values.maxDisplayableBadges = value as number;
            else if (key === 'memberRowTheme') values.memberRowTheme = value as RowTheme;
            else if (key === 'memberRowEffects') values.memberRowEffects = [...value as readonly RowVisualEffectId[]];
            else values[key] = value as boolean;
        }
        return values;
    }

    private async persist(overrides: Map<OperatorAppearanceKey, boolean | number | RowTheme | readonly RowVisualEffectId[]>): Promise<void> {
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
        const settings = this.settings;
        Object.freeze(settings.memberRowEffects);
        return Object.freeze({
            sessionId: this.sessionId,
            revision: this.revision,
            settings: Object.freeze(settings),
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
