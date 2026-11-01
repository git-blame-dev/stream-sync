// The native URL parser ignores ASCII tab/newline within protocols and userinfo.
const WEB_PROTOCOL = String.raw`(?:h[\t\r\n]*t[\t\r\n]*t[\t\r\n]*p(?:[\t\r\n]*s)?|w[\t\r\n]*s(?:[\t\r\n]*s)?)[\t\r\n]*:[\t\r\n]*\/[\t\r\n]*\/`;
const PROTOCOL_AT_START = new RegExp(`^(?:${WEB_PROTOCOL})`, 'i');
type TextSpan = { kind: 'quote' | 'url'; index: number; end: number; closed: boolean };

function isQuotedLogStart(text: string, index: number): boolean {
    return (text[index] === '"' || text[index] === "'")
        && (index === 0 || !/[a-z0-9_\\-]/i.test(text[index - 1]!));
}

function readQuotedLogText(text: string, start: number): { end: number; closed: boolean } {
    const quote = text[start];
    let end = start + 1;
    while (end < text.length) {
        if (text[end] === '\\') { end = Math.min(end + 2, text.length); continue; }
        if (text[end++] === quote) return { end, closed: true };
    }
    return { end, closed: false };
}

function readWebUrl(text: string, afterProtocol: number): { end: number; closed: boolean } {
    let end = afterProtocol;
    while (end < text.length) {
        const character = text[end]!;
        if (character === '"' || character === "'") {
            const quoted = readQuotedLogText(text, end);
            if (!quoted.closed) return { end: text.length, closed: false };
            end = quoted.end;
            continue;
        }
        if (/[\t\r\n]/.test(character)) {
            let after = end + 1;
            while (after < text.length && /[\t\r\n]/.test(text[after]!)) after++;
            if (PROTOCOL_AT_START.test(text.slice(after))) break;
            end = after;
            continue;
        }
        if (/\s/.test(character)) break;
        end++;
    }
    return { end, closed: true };
}

function* logTextSpans(text: string): Generator<TextSpan> {
    const protocols = new RegExp(WEB_PROTOCOL, 'gi');
    let protocol = protocols.exec(text);
    let cursor = 0;
    while (cursor < text.length) {
        if (protocol && cursor === protocol.index) {
            const span = readWebUrl(text, protocols.lastIndex);
            yield { kind: 'url', index: cursor, ...span };
            cursor = span.end;
        } else if (isQuotedLogStart(text, cursor)) {
            const span = readQuotedLogText(text, cursor);
            yield { kind: 'quote', index: cursor, ...span };
            cursor = span.end;
        } else cursor++;
        if (protocol && protocol.index < cursor) {
            protocols.lastIndex = cursor;
            protocol = protocols.exec(text);
        }
    }
}

function* webUrlSpans(text: string): Generator<{ index: number; value: string; closed: boolean }> {
    for (const span of logTextSpans(text)) {
        if (span.kind === 'url') yield { index: span.index, value: text.slice(span.index, span.end), closed: span.closed };
    }
}

function replaceWebUrls(text: string, replace: (value: string, closed: boolean) => string): string {
    let result = '';
    let copied = 0;
    for (const span of webUrlSpans(text)) {
        result += text.slice(copied, span.index) + replace(span.value, span.closed);
        copied = span.index + span.value.length;
    }
    return result + text.slice(copied);
}

function mapQuotedLogText(text: string, quoted: (value: string, closed: boolean) => string,
    plain: (value: string) => string = value => value): string {
    let result = '';
    let copied = 0;
    for (const span of logTextSpans(text)) {
        if (span.kind !== 'quote') continue;
        result += plain(text.slice(copied, span.index)) + quoted(text.slice(span.index, span.end), span.closed);
        copied = span.end;
    }
    return result + plain(text.slice(copied));
}

export { isQuotedLogStart, readQuotedLogText, mapQuotedLogText, webUrlSpans, replaceWebUrls };
