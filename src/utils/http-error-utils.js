const DEFAULT_MAX_RESPONSE_SNIPPET_LENGTH = 1000;
const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /(token|authorization|client_secret|secret|password)/i;

const sanitizeUrl = (url) => {
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

const toLowerMethod = (method) => {
    if (typeof method !== 'string') return null;
    const normalized = method.trim().toLowerCase();
    return normalized ? normalized : null;
};

const redactSensitiveData = (value, depth = 0) => {
    if (value === null || value === undefined) return value;
    if (depth >= 6) return '[Truncated]';

    if (Array.isArray(value)) {
        return value.map((entry) => redactSensitiveData(entry, depth + 1));
    }

    if (typeof value === 'object') {
        const redacted = {};

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

const safeStringify = (value) => {
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

const truncate = (value, maxLength) => {
    if (typeof value !== 'string') return value;
    if (!Number.isFinite(maxLength) || maxLength <= 0) return null;
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength);
};

function extractHttpErrorDetails(error, options = {}) {
    const maxResponseSnippetLength = Number.isFinite(options.maxResponseSnippetLength)
        ? options.maxResponseSnippetLength
        : DEFAULT_MAX_RESPONSE_SNIPPET_LENGTH;

    const isErrorObject = error && typeof error === 'object';
    const isAxiosError = isErrorObject && error.isAxiosError === true;

    const status = (isErrorObject && error.response && typeof error.response.status === 'number')
        ? error.response.status
        : null;
    const statusText = (isErrorObject && error.response && typeof error.response.statusText === 'string')
        ? error.response.statusText
        : null;

    const responseData = isErrorObject ? error.response?.data : null;
    const responseDataObject = responseData && typeof responseData === 'object';

    const serviceError = responseDataObject && typeof responseData.error === 'string'
        ? responseData.error
        : responseDataObject && typeof responseData.code === 'string'
            ? responseData.code
            : null;

    const serviceMessage = responseDataObject && typeof responseData.message === 'string'
        ? responseData.message
        : responseDataObject && typeof responseData.error_description === 'string'
            ? responseData.error_description
            : null;

    const message = typeof serviceMessage === 'string'
        ? serviceMessage
        : isErrorObject && typeof error.message === 'string'
            ? error.message
            : String(error);

    const code = isErrorObject && typeof error.code === 'string' ? error.code : null;

    const method = isErrorObject ? toLowerMethod(error.config?.method) : null;
    const url = isErrorObject ? sanitizeUrl(error.config?.url) : null;

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

module.exports = {
    extractHttpErrorDetails
};

