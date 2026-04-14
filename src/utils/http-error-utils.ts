const DEFAULT_MAX_RESPONSE_SNIPPET_LENGTH = 1000;
const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /(token|authorization|client_secret|secret|password)/i;

type HttpErrorExtractionOptions = {
    maxResponseSnippetLength?: number;
};

type ExtractedHttpErrorDetails = {
    message: string;
    code: string | null;
    status: number | null;
    statusText: string | null;
    serviceError: string | null;
    serviceMessage: string | null;
    isAxiosError: boolean;
    method: string | null;
    url: string | null;
    responseSnippet: string | null;
};

const sanitizeUrl = (url: unknown): string | null => {
    if (typeof url !== 'string') return null;

    const withoutHash = url.split('#', 1)[0];
    const withoutQuery = withoutHash.split('?', 1)[0];

    try {
        const parsed = new URL(withoutQuery);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return withoutQuery;
    }
};

const toLowerMethod = (method: unknown): string | null => {
    if (typeof method !== 'string') return null;
    const normalized = method.trim().toLowerCase();
    return normalized ? normalized : null;
};

const redactSensitiveData = (value: unknown, depth = 0): unknown => {
    if (value === null || value === undefined) return value;
    if (depth >= 6) return '[Truncated]';

    if (Array.isArray(value)) {
        return value.map((entry) => redactSensitiveData(entry, depth + 1));
    }

    if (typeof value === 'object') {
        const redacted: Record<string, unknown> = {};

        for (const [key, entry] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                redacted[key] = REDACTED_VALUE;
            } else {
                redacted[key] = redactSensitiveData(entry, depth + 1);
            }
        }

        return redacted;
    }

    return value;
};

const safeStringify = (value: unknown): string | null => {
    try {
        return JSON.stringify(value);
    } catch {
        try {
            return String(value);
        } catch {
            return null;
        }
    }
};

const truncate = (value: unknown, maxLength: number): string | null => {
    if (typeof value !== 'string') return value;
    if (!Number.isFinite(maxLength) || maxLength <= 0) return null;
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength);
};

function extractHttpErrorDetails(error: unknown, options: HttpErrorExtractionOptions = {}): ExtractedHttpErrorDetails {
    const maxResponseSnippetLength = Number.isFinite(options.maxResponseSnippetLength)
        ? options.maxResponseSnippetLength
        : DEFAULT_MAX_RESPONSE_SNIPPET_LENGTH;

    const isErrorObject = error && typeof error === 'object';
    const errorObject = isErrorObject ? error as Record<string, unknown> : null;
    const responseObject = errorObject && typeof errorObject.response === 'object' && errorObject.response !== null
        ? errorObject.response as Record<string, unknown>
        : null;
    const configObject = errorObject && typeof errorObject.config === 'object' && errorObject.config !== null
        ? errorObject.config as Record<string, unknown>
        : null;
    const responseData = responseObject?.data;
    const responseDataObject = responseData && typeof responseData === 'object'
        ? responseData as Record<string, unknown>
        : null;
    const isAxiosError = errorObject?.isAxiosError === true;

    const status = (responseObject && typeof responseObject.status === 'number')
        ? responseObject.status
        : null;
    const statusText = (responseObject && typeof responseObject.statusText === 'string')
        ? responseObject.statusText
        : null;

    const serviceError = responseDataObject && typeof responseDataObject.error === 'string'
        ? responseDataObject.error
        : responseDataObject && typeof responseDataObject.code === 'string'
            ? responseDataObject.code
            : null;

    const serviceMessage = responseDataObject && typeof responseDataObject.message === 'string'
        ? responseDataObject.message
        : responseDataObject && typeof responseDataObject.error_description === 'string'
            ? responseDataObject.error_description
            : null;

    const message = typeof serviceMessage === 'string'
        ? serviceMessage
        : errorObject && typeof errorObject.message === 'string'
            ? errorObject.message
            : String(error);

    const code = errorObject && typeof errorObject.code === 'string' ? errorObject.code : null;

    const method = configObject ? toLowerMethod(configObject.method) : null;
    const url = configObject ? sanitizeUrl(configObject.url) : null;

    let responseSnippet = null;
    if (responseData !== undefined && responseData !== null) {
        const redacted = responseDataObject ? redactSensitiveData(responseData) : responseData;
        responseSnippet = truncate(safeStringify(redacted), maxResponseSnippetLength);
    }

    return {
        message,
        code,
        status,
        statusText,
        serviceError,
        serviceMessage,
        isAxiosError,
        method,
        url,
        responseSnippet
    };
}

export {
    extractHttpErrorDetails
};
