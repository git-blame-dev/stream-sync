import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateFundingGoalLabel } from '../core/funding-goal-label';
import type { MonetizationValuesConfig, SynchronousUsdConverter } from '../core/monetization-values';

const MICROS_PER_USD = 1_000_000;
const STATE_VERSION = 1;
const DEFAULT_MAX_PROCESSED_EVENT_KEYS = 10_000;
const MONETIZATION_TYPES = new Set([
    'platform:gift',
    'platform:paypiggy',
    'platform:giftpaypiggy'
]);

interface FundingGoalConfig {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    readonly targetUsd: number;
}

interface FundingGoalEventBus {
    subscribe(eventName: string, handler: (payload: unknown) => unknown): (() => void) | null | undefined;
}

interface FundingGoalFileSystem {
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    mkdir(path: string, options: { recursive: true; mode?: number }): Promise<unknown>;
    writeFile(path: string, data: string, options: { encoding: 'utf8'; mode?: number }): Promise<unknown>;
    rename(from: string, to: string): Promise<void>;
    unlink(path: string): Promise<void>;
}

interface FundingGoalSnapshot {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    readonly labelOverridden: boolean;
    readonly currentUsd: number;
    readonly targetUsd: number;
    readonly completed: boolean;
    readonly revision: number;
    readonly sessionId: string;
}

interface FundingGoalServiceOptions {
    readonly config: FundingGoalConfig;
    readonly monetizationValuesConfig: MonetizationValuesConfig;
    readonly fiatToUsd?: SynchronousUsdConverter;
    readonly eventBus?: FundingGoalEventBus;
    readonly filePath?: string;
    readonly fs?: FundingGoalFileSystem;
    readonly warn?: (message: string) => void;
    readonly debug?: (message: string) => void;
    readonly maxProcessedEventKeys?: number;
}

interface FundingGoalPersistedState {
    readonly version: number;
    readonly goalId: string;
    readonly currentMicros: number;
    readonly processedEventKeys: readonly string[];
    readonly revision: number;
    readonly labelOverride?: string;
}

type UnknownRecord = Record<string, unknown>;

const REQUIRED_MONETIZATION_VALUE_KEYS = [
    'tiktokGiftUnitUsd',
    'twitchBitUsd',
    'youtubeJewelUsd',
    'tiktokMembershipUsd',
    'twitchMembershipUsd',
    'youtubeMembershipUsd'
] as const;

function validateMonetizationValuesConfig(value: unknown): asserts value is MonetizationValuesConfig {
    const config = asRecord(value);
    if (!config) {
        throw new TypeError('monetizationValuesConfig must be a non-null object');
    }
    for (const key of REQUIRED_MONETIZATION_VALUE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(config, key)) {
            throw new TypeError(`monetizationValuesConfig.${key} is required`);
        }
        const field = config[key];
        if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) {
            throw new RangeError(`monetizationValuesConfig.${key} must be a finite number >= 0`);
        }
    }
}

function asRecord(value: unknown): UnknownRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : null;
}

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function positiveFinite(value: unknown): number | null {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function usdToMicros(amount: number, usdPerUnit = 1): number {
    return Math.round(amount * usdPerUnit * MICROS_PER_USD);
}

function eventKey(platform: string, type: string, data: UnknownRecord): string | null {
    const id = typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id).trim() : '';
    const timestamp = typeof data.timestamp === 'string' ? data.timestamp.trim() : '';
    if (!id && !timestamp) return null;
    const fingerprint = id
        ? JSON.stringify([platform, type, id])
        : JSON.stringify([
            platform,
            type,
            timestamp,
            data.userId ?? null,
            data.tier ?? data.membershipLevel ?? null,
            data.months ?? null,
            data.giftCount ?? null,
            data.giftType ?? null,
            data.amount ?? null,
            data.currency ?? null,
            data.isRenewal ?? null,
            data.isAnonymous ?? null
        ]);
    return `${platform}:${type}:sha256:${createHash('sha256').update(fingerprint).digest('hex')}`;
}

function contributionMicros(
    platform: string,
    type: string,
    data: UnknownRecord,
    values: MonetizationValuesConfig,
    fiatToUsd?: SynchronousUsdConverter,
    debug?: (message: string) => void
): number {
    if (data.isError === true) {
        debug?.(`Skipped errored monetization event: ${platform} ${type}`);
        return 0;
    }

    if (type === 'platform:gift') {
        const amount = positiveFinite(data.amount);
        const currency = typeof data.currency === 'string' ? data.currency.trim().toLowerCase() : '';
        if (amount === null) {
            debug?.(`Skipped gift with missing or non-positive amount: ${platform}`);
            return 0;
        }
        if (platform === 'tiktok' && currency === 'coins') {
            return usdToMicros(amount, values.tiktokGiftUnitUsd);
        }
        if (platform === 'twitch' && currency === 'bits') {
            return usdToMicros(amount, values.twitchBitUsd);
        }
        if (platform === 'youtube' && (currency === 'usd' || currency === 'dollars')) {
            return usdToMicros(amount);
        }
        if (platform === 'youtube' && currency === 'jewels') {
            return usdToMicros(amount, values.youtubeJewelUsd);
        }
        if (platform === 'youtube' && fiatToUsd) {
            const converted = fiatToUsd(amount, currency);
            if (converted !== null && Number.isFinite(converted) && converted > 0) {
                return usdToMicros(converted);
            }
            debug?.(`Skipped YouTube gift with unavailable USD conversion: ${currency || 'missing currency'}`);
            return 0;
        }
        debug?.(`Skipped gift with unsupported currency: ${platform} ${currency || 'missing currency'}`);
        return 0;
    }

    const giftCount = Number(data.giftCount);
    const count = type === 'platform:giftpaypiggy'
        ? (Number.isSafeInteger(giftCount) && giftCount > 0 ? giftCount : null)
        : 1;
    if (count === null) {
        debug?.(`Skipped membership with invalid gift count: ${platform}`);
        return 0;
    }
    if (platform === 'tiktok') {
        return usdToMicros(values.tiktokMembershipUsd * count);
    }
    if (platform === 'twitch') {
        return usdToMicros(values.twitchMembershipUsd * count);
    }
    if (platform === 'youtube') {
        return usdToMicros(values.youtubeMembershipUsd * count);
    }
    debug?.(`Skipped membership from unsupported platform: ${platform}`);
    return 0;
}

class FundingGoalService {
    private readonly config: FundingGoalConfig;
    private readonly monetizationValuesConfig: MonetizationValuesConfig;
    private readonly fiatToUsd: SynchronousUsdConverter | undefined;
    private readonly eventBus: FundingGoalEventBus | undefined;
    private readonly filePath: string;
    private readonly fs: FundingGoalFileSystem;
    private readonly warn: (message: string) => void;
    private readonly debug: (message: string) => void;
    private readonly maxProcessedEventKeys: number;
    private readonly sessionId = randomUUID();
    private currentMicros = 0;
    private currentRevision = 0;
    private labelOverride: string | undefined;
    private processedEventKeys = new Set<string>();
    private listeners = new Set<(snapshot: FundingGoalSnapshot) => void>();
    private operation: Promise<void> = Promise.resolve();
    private tempSequence = 0;
    private unsubscribeEventBus: (() => void) | null = null;
    private disposed = false;
    private disposePromise: Promise<void> | null = null;

    private constructor(options: FundingGoalServiceOptions) {
        validateMonetizationValuesConfig(options.monetizationValuesConfig);
        this.config = options.config;
        this.monetizationValuesConfig = options.monetizationValuesConfig;
        this.fiatToUsd = options.fiatToUsd;
        this.eventBus = options.eventBus;
        this.filePath = options.filePath ?? './data/funding-goal.json';
        this.fs = options.fs ?? { readFile, mkdir, writeFile, rename, unlink };
        this.warn = options.warn ?? (() => undefined);
        this.debug = options.debug ?? (() => undefined);
        this.maxProcessedEventKeys = Number.isSafeInteger(options.maxProcessedEventKeys) && Number(options.maxProcessedEventKeys) > 0
            ? Number(options.maxProcessedEventKeys)
            : DEFAULT_MAX_PROCESSED_EVENT_KEYS;
    }

    static async create(options: FundingGoalServiceOptions): Promise<FundingGoalService> {
        const service = new FundingGoalService(options);
        await service.load();
        service.start();
        return service;
    }

    get snapshot(): FundingGoalSnapshot {
        return Object.freeze({
            enabled: this.config.enabled,
            id: this.config.id,
            label: this.labelOverride ?? this.config.label,
            labelOverridden: this.labelOverride !== undefined,
            currentUsd: this.currentMicros / MICROS_PER_USD,
            targetUsd: this.config.targetUsd,
            completed: this.currentMicros >= usdToMicros(this.config.targetUsd),
            revision: this.currentRevision,
            sessionId: this.sessionId
        });
    }

    subscribe(listener: (snapshot: FundingGoalSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    processPlatformEvent(payload: unknown): Promise<void> {
        if (!this.config.enabled) return Promise.resolve();
        const event = asRecord(payload);
        const platform = typeof event?.platform === 'string' ? event.platform.trim().toLowerCase() : '';
        const type = typeof event?.type === 'string' ? event.type.trim() : '';
        const data = asRecord(event?.data);
        if (!platform || !MONETIZATION_TYPES.has(type) || !data) return Promise.resolve();

        const amountMicros = contributionMicros(
            platform,
            type,
            data,
            this.monetizationValuesConfig,
            this.fiatToUsd,
            this.debug
        );
        const key = eventKey(platform, type, data);
        if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0 || !key) {
            this.debug(`Skipped unvalued or unidentifiable funding event: ${platform} ${type}`);
            return Promise.resolve();
        }

        return this.enqueue(async () => {
            if (this.processedEventKeys.has(key)) return;
            const nextMicros = this.currentMicros + amountMicros;
            if (!Number.isSafeInteger(nextMicros)) {
                throw new RangeError('Funding goal total exceeds the supported range');
            }
            const nextKeys = new Set(this.processedEventKeys).add(key);
            while (nextKeys.size > this.maxProcessedEventKeys) {
                const oldestKey = nextKeys.values().next().value;
                if (typeof oldestKey !== 'string') break;
                nextKeys.delete(oldestKey);
            }
            await this.persist(nextMicros, nextKeys, this.currentRevision + 1, this.labelOverride);
            this.currentMicros = nextMicros;
            this.processedEventKeys = nextKeys;
            this.currentRevision += 1;
            this.notify();
        });
    }

    adjust(amountUsd: number): Promise<void> {
        const amountMicros = usdToMicros(Number(amountUsd));
        if (!Number.isFinite(Number(amountUsd)) || !Number.isSafeInteger(amountMicros) || amountMicros === 0) {
            return Promise.reject(new RangeError('Funding goal adjustment must be a finite nonzero amount'));
        }
        return this.enqueue(async () => {
            const nextMicros = this.currentMicros + amountMicros;
            if (!Number.isSafeInteger(nextMicros) || nextMicros < 0) {
                throw new RangeError('Funding goal total cannot be negative or exceed the supported range');
            }
            await this.persist(nextMicros, this.processedEventKeys, this.currentRevision + 1, this.labelOverride);
            this.currentMicros = nextMicros;
            this.currentRevision += 1;
            this.notify();
        });
    }

    setTotal(amountUsd: number): Promise<void> {
        const amountMicros = usdToMicros(Number(amountUsd));
        if (!Number.isSafeInteger(amountMicros) || amountMicros < 0) {
            return Promise.reject(new RangeError('Funding goal total must be a non-negative amount'));
        }
        return this.enqueue(async () => {
            await this.persist(amountMicros, this.processedEventKeys, this.currentRevision + 1, this.labelOverride);
            this.currentMicros = amountMicros;
            this.currentRevision += 1;
            this.notify();
        });
    }

    setLabel(label: string): Promise<void> {
        let validated: string;
        try {
            validated = validateFundingGoalLabel(label);
        } catch (error) {
            return Promise.reject(error);
        }
        return this.enqueue(async () => {
            if ((this.labelOverride ?? this.config.label) === validated) return;
            await this.persist(this.currentMicros, this.processedEventKeys, this.currentRevision + 1, validated);
            this.labelOverride = validated;
            this.currentRevision += 1;
            this.notify();
        });
    }

    resetLabel(): Promise<void> {
        return this.enqueue(async () => {
            if (this.labelOverride === undefined) return;
            await this.persist(this.currentMicros, this.processedEventKeys, this.currentRevision + 1, undefined);
            this.labelOverride = undefined;
            this.currentRevision += 1;
            this.notify();
        });
    }

    async dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        this.unsubscribeEventBus?.();
        this.unsubscribeEventBus = null;
        this.listeners.clear();
        this.disposePromise = this.operation;
        await this.disposePromise;
    }

    private start(): void {
        if (!this.config.enabled || !this.eventBus) return;
        const unsubscribe = this.eventBus.subscribe('platform:event', payload => this.processPlatformEvent(payload));
        this.unsubscribeEventBus = typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    private async load(): Promise<void> {
        let text: string;
        try {
            text = await this.fs.readFile(this.filePath, 'utf8');
        } catch (error) {
            if (!isMissingFileError(error)) this.warn('Unable to read funding goal state; starting from zero');
            return;
        }

        try {
            const parsed = asRecord(JSON.parse(text));
            if (!parsed || parsed.version !== STATE_VERSION || parsed.goalId !== this.config.id) return;
            const currentMicros = parsed.currentMicros;
            const revision = parsed.revision;
            const processedEventKeys = parsed.processedEventKeys;
            const labelOverride = parsed.labelOverride;
            if (!Number.isSafeInteger(currentMicros) || Number(currentMicros) < 0) {
                throw new TypeError('Invalid funding goal total');
            }
            if (!Number.isSafeInteger(revision) || Number(revision) < 0) {
                throw new TypeError('Invalid funding goal revision');
            }
            if (!Array.isArray(processedEventKeys) || !processedEventKeys.every(key => typeof key === 'string')) {
                throw new TypeError('Invalid funding goal event keys');
            }
            const validatedLabel = labelOverride === undefined ? undefined : validateFundingGoalLabel(labelOverride);
            this.currentMicros = Number(currentMicros);
            this.currentRevision = Number(revision);
            this.processedEventKeys = new Set(processedEventKeys.slice(-this.maxProcessedEventKeys));
            this.labelOverride = validatedLabel;
        } catch {
            this.warn('Malformed funding goal state; starting from zero');
        }
    }

    private async persist(currentMicros: number, processedEventKeys: Set<string>, revision: number, labelOverride: string | undefined): Promise<void> {
        const state: FundingGoalPersistedState = {
            version: STATE_VERSION,
            goalId: this.config.id,
            currentMicros,
            processedEventKeys: [...processedEventKeys],
            revision,
            ...(labelOverride === undefined ? {} : { labelOverride })
        };
        const tempPath = `${this.filePath}.tmp-${process.pid}-${++this.tempSequence}`;
        try {
            await this.fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
            await this.fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
        if (this.disposed) return Promise.reject(new Error('Funding goal service is disposed'));
        const result = this.operation.then(task, task);
        this.operation = result.catch(() => undefined);
        return result;
    }

    private notify(): void {
        const snapshot = this.snapshot;
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            } catch {
                // A failed listener cannot roll back a persisted update.
            }
        }
    }
}

const createFundingGoalService = FundingGoalService.create;

export {
    createFundingGoalService,
    FundingGoalService
};
export type {
    FundingGoalConfig,
    FundingGoalEventBus,
    FundingGoalFileSystem,
    FundingGoalServiceOptions,
    FundingGoalSnapshot,
    MonetizationValuesConfig
};
