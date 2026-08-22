import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PROVIDER_URL = 'https://api.frankfurter.dev/v2/rates?base=USD';
const DEFAULT_CACHE_PATH = './data/usd-rates.json';
const DEFAULT_TIMEOUT_MS = 5_000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface UsdRateService {
    readonly rates: Readonly<Record<string, number>>;
    convertToUsd(amount: number, currency: string): number | null;
}

export interface UsdRateFileSystem {
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    mkdir(path: string, options: { recursive: true; mode?: number }): Promise<unknown>;
    writeFile(path: string, data: string, options: { encoding: 'utf8'; mode?: number }): Promise<unknown>;
    rename(from: string, to: string): Promise<void>;
    unlink(path: string): Promise<void>;
}

export interface UsdRateServiceOptions {
    readonly cachePath?: string;
    readonly fetch?: (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
    readonly fs?: UsdRateFileSystem;
    readonly timeoutMs?: number;
    readonly setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
    readonly clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
    readonly warn?: (message: string) => void;
}

type RateTable = Record<string, number>;

function validRates(value: unknown): RateTable | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const result: RateTable = { USD: 1 };
    for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
        if (!CURRENCY_CODE.test(code) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
        if (code === 'USD' && rate !== 1) return null;
        result[code] = rate;
    }
    return Object.keys(result).length > 1 ? result : null;
}

function providerRates(value: unknown): RateTable | null {
    if (!Array.isArray(value)) return null;
    const table: Record<string, unknown> = {};
    for (const entry of value) {
        if (entry === null || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        if (typeof record.currency !== 'string' || Object.hasOwn(table, record.currency)) return null;
        table[record.currency] = record.rate;
    }
    return validRates(table);
}

export async function createUsdRateService(options: UsdRateServiceOptions = {}): Promise<UsdRateService> {
    const fs = options.fs ?? { readFile, mkdir, writeFile, rename, unlink };
    const warn = options.warn ?? (() => undefined);
    const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    const fetcher = options.fetch ?? (fetch as unknown as NonNullable<UsdRateServiceOptions['fetch']>);
    let table: RateTable | null = null;

    try {
        const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, unknown>;
        if (parsed.version !== 1 || parsed.base !== 'USD') throw new Error('cache metadata is invalid');
        table = validRates(parsed.rates);
        if (!table) throw new Error('cache rates are invalid');
    } catch {
        warn('USD rate cache unavailable or invalid; attempting Frankfurter refresh');
    }

    try {
        const controller = new AbortController();
        const setTimer = options.setTimeout ?? setTimeout;
        const clearTimer = options.clearTimeout ?? clearTimeout;
        const timeout = setTimer(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
            const response = await fetcher(PROVIDER_URL, { signal: controller.signal });
            if (!response.ok) throw new Error(`Frankfurter returned HTTP ${response.status}`);
            const refreshed = providerRates(await response.json());
            if (!refreshed) throw new Error('Frankfurter returned invalid USD rates');
            table = refreshed;
            const tempPath = `${cachePath}.tmp-${process.pid}`;
            try {
                await fs.mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
                await fs.writeFile(tempPath, `${JSON.stringify({ version: 1, base: 'USD', rates: refreshed })}\n`, { encoding: 'utf8', mode: 0o600 });
                await fs.rename(tempPath, cachePath);
            } catch (error) {
                try { await fs.unlink(tempPath); } catch { /* best effort cleanup */ }
                warn(`Unable to persist refreshed USD rates: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            clearTimer(timeout as ReturnType<typeof setTimeout>);
        }
    } catch (error) {
        warn(`USD rate refresh failed; ${table ? 'using cached rates' : 'foreign-currency conversion unavailable'}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rates = Object.freeze(table ?? { USD: 1 });
    return Object.freeze({
        rates,
        convertToUsd(amount: number, currency: string): number | null {
            if (!Number.isFinite(amount)) return null;
            const code = currency.trim().toUpperCase();
            if (code === 'USD') return amount;
            const rate = rates[code];
            return rate === undefined ? null : amount / rate;
        }
    });
}

export { PROVIDER_URL };
