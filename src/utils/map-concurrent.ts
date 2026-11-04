/** Preserve input order while refilling each available worker slot. */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number,
    operation: (item: T, index: number) => Promise<R>): Promise<R[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Concurrency must be a positive integer');
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await operation(items[index]!, index);
        }
    }));
    return results;
}
