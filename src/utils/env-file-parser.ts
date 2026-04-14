export type ParseEnvContentOptions = {
    ignoreEmptyKeys?: boolean;
};

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

        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        acc[key] = value;
        return acc;
    }, {});
}
