import { describe, expect, test } from 'bun:test';
import { createUsdRateService, PROVIDER_URL, type UsdRateFileSystem } from '../../src/services/usd-rate-service';

function memoryFs(initial?: string): UsdRateFileSystem & { files: Map<string, string> } {
    const files = new Map<string, string>(initial ? [['cache.json', initial]] : []);
    return { files, readFile: async path => { const value = files.get(path); if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return value; }, mkdir: async () => undefined, writeFile: async (path, data) => { files.set(path, data); }, rename: async (from, to) => { files.set(to, files.get(from)!); files.delete(from); }, unlink: async path => { files.delete(path); } };
}

describe('USD rate service', () => {
    test('loads cache, refreshes once, and converts synchronously', async () => {
        const fs = memoryFs(JSON.stringify({ version: 1, base: 'USD', rates: { EUR: 0.8 } }));
        let calls = 0;
        const service = await createUsdRateService({ cachePath: 'cache.json', fs, fetch: async url => { calls++; expect(url).toBe(PROVIDER_URL); return { ok: true, status: 200, json: async () => [{ date: '2026-08-22', base: 'USD', quote: 'EUR', rate: 0.8 }, { date: '2026-08-22', base: 'USD', quote: 'JPY', rate: 150 }] }; } });
        expect(calls).toBe(1);
        expect(service.convertToUsd(15, 'eur')).toBe(18.75);
        expect(service.convertToUsd(150, 'JPY')).toBe(1);
        expect(service.convertToUsd(10, 'USD')).toBe(10);
        expect(service.convertToUsd(1, 'GBP')).toBeNull();
        expect(service.rates.USD).toBe(1);
    });

    test('survives provider failure and invalid cache', async () => {
        const warnings: string[] = [];
        const service = await createUsdRateService({ cachePath: 'missing.json', fs: memoryFs(), fetch: async () => { throw new Error('offline'); }, warn: message => warnings.push(message) });
        expect(service.convertToUsd(3, 'USD')).toBe(3);
        expect(service.convertToUsd(3, 'EUR')).toBeNull();
        expect(warnings.length).toBeGreaterThanOrEqual(2);
    });

    test('rejects invalid cache metadata and rate tables', async () => {
        for (const rates of [{ USD: 2, EUR: 0.8 }, { EUR: Number.NaN }, { EUR: 0 }]) {
            const service = await createUsdRateService({ cachePath: 'cache.json', fs: memoryFs(JSON.stringify({ version: 1, base: 'USD', rates })), fetch: async () => { throw new Error('offline'); } });
            expect(service.convertToUsd(3, 'EUR')).toBeNull();
        }
        const wrongVersion = await createUsdRateService({ cachePath: 'cache.json', fs: memoryFs(JSON.stringify({ version: 2, base: 'USD', rates: { EUR: 0.8 } })), fetch: async () => { throw new Error('offline'); } });
        expect(wrongVersion.convertToUsd(3, 'EUR')).toBeNull();
    });

    test('rejects duplicate and malformed provider rows without changing USD', async () => {
        for (const rows of [
            [{ date: '2026-08-22', base: 'USD', quote: 'EUR', rate: 0.8 }, { date: '2026-08-22', base: 'USD', quote: 'EUR', rate: 0.9 }],
            [{ date: '2026-08-22', base: 'USD', quote: 'usd', rate: 2 }],
            [{ date: '2026-08-22', base: 'USD', quote: 'EURO', rate: 0.8 }],
            [{ date: '2026-08-22', base: 'EUR', quote: 'JPY', rate: 150 }],
        ]) {
            const service = await createUsdRateService({ cachePath: 'missing.json', fs: memoryFs(), fetch: async () => ({ ok: true, status: 200, json: async () => rows }) });
            expect(service.rates.USD).toBe(1);
            expect(service.convertToUsd(8, 'EUR')).toBeNull();
        }
    });

    test('uses USD-base rates for foreign-to-USD conversion', async () => {
        const service = await createUsdRateService({ cachePath: 'missing.json', fs: memoryFs(), fetch: async () => ({ ok: true, status: 200, json: async () => [{ date: '2026-08-22', base: 'USD', quote: 'EUR', rate: 0.8 }] }) });
        expect(service.convertToUsd(8, 'EUR')).toBe(10);
    });
});
