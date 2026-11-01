import { webUrlSpans, isQuotedLogStart, readQuotedLogText, mapQuotedLogText } from './web-url-pattern';

// One key policy for raw capture, structured diagnostics, and free-text assignments.
const CREDENTIAL_KEY = /^(?:authorization|proxyauthorization|accessToken|refreshToken|idToken|authToken|jwtToken|sessionToken|token|clientSecret|secret|password|passwd|cookie|setCookie|sessionId|apiKey|xApiKey|accessKeyId|awsAccessKeyId|privateKey|signingKey|signature|sig|credential|credentials|keyPairId|policy|xAmz.*|xGoog.*)$/i;
export function isCredentialKey(key: string): boolean {
    return CREDENTIAL_KEY.test(key.replace(/[^a-z0-9]/gi, ''));
}

function redactQuotedAssignments(candidate: string, depth: number): string {
    const quote = candidate[0]!;
    if (depth >= 12) return `${quote}[Credential text omitted]${quote}`;
    if (quote === '"') {
        try {
            const decoded: unknown = JSON.parse(candidate);
            if (typeof decoded === 'string') {
                const safe = redactCredentialText(decoded, undefined, false, depth + 1);
                return safe === decoded ? candidate : JSON.stringify(safe);
            }
        } catch { /* Non-JSON quoted diagnostics retain their enclosing boundary. */ }
    }
    return quote + redactCredentialText(candidate.slice(1, -1), undefined, false, depth + 1) + quote;
}

function isLabelCharacter(code: number): boolean {
    return code >= 65 && code <= 90 || code >= 97 && code <= 122
        || code >= 48 && code <= 57 || code === 45 || code === 95;
}

function readStructuredValue(text: string, start: number): { end: number; closed: boolean } {
    const stack = [text[start]];
    let end = start + 1;
    while (end < text.length) {
        const character = text[end];
        if (character === '"' || character === "'") {
            const quoted = readQuotedLogText(text, end);
            if (!quoted.closed) return { end: text.length, closed: false };
            end = quoted.end;
            continue;
        }
        if (character === '{' || character === '[') {
            if (stack.length >= 12) return { end: text.length, closed: false };
            stack.push(character);
        } else if (character === '}' || character === ']') {
            if (stack.pop() !== (character === '}' ? '{' : '[')) return { end: text.length, closed: false };
            if (!stack.length) return { end: end + 1, closed: true };
        }
        end++;
    }
    return { end, closed: false };
}

// Each token/span is consumed once. Quoted primitives are decoded only within
// the depth bound; malformed spans are omitted rather than rescanned.
export function redactCredentialText(text: string, sanitizeQuoted?: (value: string) => string, standaloneOnly = false, depth = 0): string {
    if (!/[:=\\]|\bbearer\s/i.test(text)) return text;
    if (!sanitizeQuoted) text = mapQuotedLogText(text, (candidate, closed) => closed
        ? redactQuotedAssignments(candidate, depth)
        : `${candidate[0]}[Unterminated quoted text omitted]${candidate[0]}`);
    const urls = webUrlSpans(text);
    let url = urls.next().value;
    let result = '';
    let copied = 0;
    let cursor = 0;
    const unclosedFrom: Record<string, number> = { '"': Infinity, "'": Infinity };
    while (cursor < text.length) {
        const tokenStart = cursor;
        const quotedLabel = text[cursor] === '"' || text[cursor] === "'";
        let key: string;
        if (quotedLabel) {
            const quote = text[cursor]!;
            if (cursor >= unclosedFrom[quote]!) { cursor++; continue; }
            const span = readQuotedLogText(text, cursor);
            if (!span.closed) {
                unclosedFrom[quote] = cursor++;
                continue;
            }
            let after = span.end;
            while (after < text.length && /\s/.test(text[after]!)) after++;
            if (text[after] !== ':' && text[after] !== '=') {
                if (!isQuotedLogStart(text, cursor)) {
                    const candidate = text.slice(cursor, span.end);
                    const safe = sanitizeQuoted ? sanitizeQuoted(candidate) : redactQuotedAssignments(candidate, depth);
                    result += text.slice(copied, cursor) + safe;
                    copied = span.end;
                }
                cursor = span.end;
                continue;
            }
            cursor = span.end;
            const label = text.slice(tokenStart, span.end);
            try { key = label.startsWith('"') ? JSON.parse(label) as string : label.slice(1, -1); }
            catch { continue; }
        } else {
            if (!isLabelCharacter(text.charCodeAt(cursor))) { cursor++; continue; }
            while (cursor < text.length && isLabelCharacter(text.charCodeAt(cursor))) cursor++;
            key = text.slice(tokenStart, cursor);
        }
        const labelEnd = cursor;
        while (cursor < text.length && /\s/.test(text[cursor]!)) cursor++;
        const bearer = !quotedLabel && key.toLowerCase() === 'bearer' && cursor > labelEnd;
        if (!bearer) {
            if (text[cursor] !== ':' && text[cursor] !== '=') continue;
            cursor++;
            while (cursor < text.length && /\s/.test(text[cursor]!)) cursor++;
        }
        let start = cursor;
        if (!bearer && standaloneOnly && (tokenStart === 0 || !/\s/.test(text[tokenStart - 1]!))) continue;
        while (url && url.index + url.value.length <= tokenStart) url = urls.next().value;
        if (!bearer && !quotedLabel && !/\s/.test(text[tokenStart - 1] ?? '')
            && url && tokenStart >= url.index && tokenStart < url.index + url.value.length) continue;
        const secret = bearer || isCredentialKey(key);
        const scheme = !sanitizeQuoted && /^(?:proxy[_-]?)?authorization$/i.test(key)
            ? /^(?:Bearer|Basic)\s+/i.exec(text.slice(start)) : null;
        if (scheme) start += scheme[0].length;
        const quote = text[start] === '"' || text[start] === "'" ? text[start] : '';
        const structured = text[start] === '{' || text[start] === '[';
        if (!quote && !structured && !secret) continue;
        let end = start;
        let closed = false;
        if (quote || structured) {
            const span = quote ? readQuotedLogText(text, start) : readStructuredValue(text, start);
            end = span.end;
            closed = span.closed;
        } else {
            const header = !scheme && /^(?:authorization|proxyAuthorization|cookie|setCookie)$/i.test(key.replace(/[^a-z0-9]/gi, ''));
            if (!sanitizeQuoted || bearer) {
                const delimiter = header ? /[\r\n]/g : /[\s,;&]/g;
                delimiter.lastIndex = start;
                end = delimiter.exec(text)?.index ?? text.length;
            } else {
                let innerQuote = '';
                while (end < text.length) {
                    const character = text[end]!;
                    if (innerQuote) {
                        if (character === '\\') { end = Math.min(end + 2, text.length); continue; }
                        if (character === innerQuote) innerQuote = '';
                    } else {
                        if ((header ? /[\r\n]/ : /\s/).test(character)) break;
                        if (character === '"' || character === "'") innerQuote = character;
                    }
                    end++;
                }
            }
        }
        if (!secret && (structured || !sanitizeQuoted && closed)) {
            cursor = structured ? start + 1 : end;
            continue;
        }
        const candidate = text.slice(start, end);
        const content = secret ? '[REDACTED]' : !closed ? '[Unterminated quoted text omitted]'
            : sanitizeQuoted ? sanitizeQuoted(candidate) : candidate;
        const retainedQuote = secret && quotedLabel ? quote || '"'
            : secret && !sanitizeQuoted ? '' : quote;
        let replacement = content;
        if (secret || !closed) replacement = retainedQuote + content + (closed || secret && quotedLabel ? retainedQuote : '');
        result += text.slice(copied, start) + replacement;
        copied = cursor = end;
    }
    return result + text.slice(copied);
}
