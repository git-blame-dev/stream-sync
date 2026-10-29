// The native URL parser ignores ASCII tab/newline within protocols and userinfo.
// Keep those controls inside a candidate, but retain a control separator before
// another protocol so one URL cannot hide a second URL's credentials.
const WEB_PROTOCOL = String.raw`(?:h[\t\r\n]*t[\t\r\n]*t[\t\r\n]*p(?:[\t\r\n]*s)?|w[\t\r\n]*s(?:[\t\r\n]*s)?)[\t\r\n]*:[\t\r\n]*\/[\t\r\n]*\/`;
const WEB_URL_SPAN_SOURCE = String.raw`${WEB_PROTOCOL}(?:\S|[\t\r\n]+(?![\t\r\n]|${WEB_PROTOCOL}))+`;
const LOG_TEXT_SPAN_SOURCE = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|${WEB_URL_SPAN_SOURCE}`;

export { WEB_URL_SPAN_SOURCE, LOG_TEXT_SPAN_SOURCE };
