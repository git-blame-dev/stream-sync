export type ParseEnvContentOptions = {
    ignoreEmptyKeys?: boolean;
};

/** Common lossless subset of the application, Bun and Node env-file loaders. */
export function encodeEnvValue(value: string): string | null {
    // Bun expands dollars even in quotes; escaping differs between loaders.
    if (/[\x00-\x1f\x7f-\x9f\\$]/.test(value)) return null;
    if (!/[\s'"`#]/.test(value)) return value;
    const quote = ["'", '"', '`'].find(candidate => !value.includes(candidate));
    return quote ? `${quote}${value}${quote}` : null;
}

export function parseEnvContent(
    content: unknown,
    options: ParseEnvContentOptions = {}
): Record<string, string> {
    const { ignoreEmptyKeys = true } = options;

    if (content === undefined || content === null) {
        return {};
    }

    return String(content).split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return acc;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) {
            return acc;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        if (!key && ignoreEmptyKeys) {
            return acc;
        }

        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const quote = rawValue[0];
        const value = rawValue.length >= 2 && (quote === "'" || quote === '"' || quote === '`') && rawValue.endsWith(quote)
            ? rawValue.slice(1, -1)
            : rawValue;
        acc[key] = value;
        return acc;
    }, {});
}
