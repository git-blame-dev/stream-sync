import { describe, expect, it } from 'bun:test';
import { BoundedOperatorLogSource, DEFAULT_MAX_ENTRY_BYTES } from '../../../../src/services/operator/operator-log-source';

describe('BoundedOperatorLogSource', () => {
  const input = (overrides: Partial<Parameters<BoundedOperatorLogSource['append']>[0]> = {}) => ({
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info' as const,
    message: 'hello',
    source: 'test',
    data: { nested: ['value', 2, true] },
    ...overrides
  });

  it('preserves the complete DTO and truncates oversized entries', () => {
    const source = new BoundedOperatorLogSource({ maxEntries: 2, maxBytes: 1000, maxEntryBytes: 256 });
    expect(source.append(input())).toEqual({ id: 1, ...input() });
    source.append(input({ message: 'second' }));
    const truncated = source.append(input({ message: 'x'.repeat(1000), source: 'y'.repeat(1000), data: ['z'.repeat(1000)] }));
    expect(truncated.id).toBe(3);
    expect(truncated.data).toBe(null);
    expect(source.history().entries.map((entry) => entry.id)).toEqual([2, 3]);
  });

  it('keeps default entries below the source limit and delivers truncation', () => {
    const source = new BoundedOperatorLogSource();
    const delivered: unknown[] = [];
    const connection = source.connect(undefined, (entry) => { delivered.push(entry); });
    const entry = source.append(input({
      message: 'x'.repeat(DEFAULT_MAX_ENTRY_BYTES * 2),
      source: 'y'.repeat(DEFAULT_MAX_ENTRY_BYTES * 2),
      data: ['z'.repeat(DEFAULT_MAX_ENTRY_BYTES * 2)]
    }));

    connection.activate();
    expect(Buffer.byteLength(JSON.stringify(entry), 'utf8')).toBeLessThan(DEFAULT_MAX_ENTRY_BYTES);
    expect(entry.data).toBe('[TRUNCATED]');
    expect(delivered).toEqual([entry]);
  });

  it('evicts by count and aggregate bytes while keeping contiguous IDs', () => {
    const byCount = new BoundedOperatorLogSource({ maxEntries: 2, maxBytes: 10000, maxEntryBytes: 256 });
    [1, 2, 3].forEach(() => byCount.append(input()));
    expect(byCount.history().entries.map((entry) => entry.id)).toEqual([2, 3]);
    const byBytes = new BoundedOperatorLogSource({ maxBytes: 250, maxEntryBytes: 256 });
    const ids = [1, 2, 3].map(() => byBytes.append(input()).id);
    expect(ids).toEqual([1, 2, 3]);
    expect(byBytes.history().entries.map((entry) => entry.id)).toEqual([3]);
    expect(byBytes.history().truncated).toBe(false);
  });

  it('atomically replays then flushes live entries in order', () => {
    const source = new BoundedOperatorLogSource();
    source.append(input({ message: 'one' }));
    const seen: number[] = [];
    const connection = source.connect(0, (entry) => {
      seen.push(entry.id);
       if (entry.id === 1) source.append(input({ message: 'two' }));
    });
    connection.activate();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([1, 2]);
    connection.activate();
  });

  it('marks high stale IDs reset, isolates throwers, and unsubscribes idempotently', () => {
    const source = new BoundedOperatorLogSource();
    source.append(input({ message: 'one' }));
    const stale = source.connect(99, () => undefined);
    expect(stale.history.truncated).toBe(true);
    let count = 0;
    const bad = source.connect(undefined, () => false);
    const throwing = source.connect(undefined, () => { throw new Error('bad'); });
    const good = source.connect(undefined, () => { count++; });
    bad.activate();
    throwing.activate();
    good.activate();
    source.append(input({ message: 'two' }));
    expect(count).toBe(2);
    good.unsubscribe(); good.unsubscribe(); source.append(input({ message: 'three' }));
    expect(count).toBe(2);
  });

  it('replays exactly the requested incremental range', () => {
    const source = new BoundedOperatorLogSource();
    [1, 2, 3].forEach((n) => source.append(input({ message: String(n) })));
    const seen: number[] = [];
    const connection = source.connect(1, (entry) => { seen.push(entry.id); });
    expect(connection.history.entries.map((entry) => entry.id)).toEqual([2, 3]);
    connection.activate();
    expect(seen).toEqual([2, 3]);
  });

  it('marks an evicted low afterId as truncated and replays the full retained range', () => {
    const source = new BoundedOperatorLogSource({ maxEntries: 2 });
    [1, 2, 3].forEach((n) => source.append(input({ message: String(n) })));
    const seen: number[] = [];

    const connection = source.connect(0, (entry) => { seen.push(entry.id); });

    expect(connection.history.truncated).toBe(true);
    expect(connection.history.entries.map((entry) => entry.id)).toEqual([2, 3]);
    connection.activate();
    expect(seen).toEqual([2, 3]);
  });

  it('does not replay or deliver live entries after unsubscribing before activation', () => {
    const source = new BoundedOperatorLogSource();
    source.append(input({ message: 'replay' }));
    const seen: number[] = [];
    const connection = source.connect(undefined, (entry) => { seen.push(entry.id); });

    connection.unsubscribe();
    connection.activate();
    source.append(input({ message: 'live' }));

    expect(seen).toEqual([]);
  });
});
