export function parseNotificationCount(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
}
