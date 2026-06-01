import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { buildGuiRuntimeConfig, type TransportRecord } from './gui-runtime-config';

type GuiPageOptions = {
    title: string;
    runtimeKind: string;
    scriptKind?: string;
    transparent?: boolean;
    includeEventGlobals?: boolean;
    guiConfig: TransportRecord;
};

function getAssetContentType(filePath: string): string {
    if (filePath.endsWith('.js')) {
        return 'application/javascript; charset=utf-8';
    }
    if (filePath.endsWith('.css')) {
        return 'text/css; charset=utf-8';
    }
    if (filePath.endsWith('.map')) {
        return 'application/json; charset=utf-8';
    }
    if (filePath.endsWith('.png')) {
        return 'image/png';
    }
    return 'application/octet-stream';
}

function resolveAssetFilePath(url: string, assetsRoot: string): string | null {
    if (!url.startsWith('/gui/assets/')) {
        return null;
    }

    let requestedPath;
    try {
        requestedPath = decodeURIComponent(url.replace('/gui/', ''));
    } catch {
        return null;
    }

    const normalizedPath = path.normalize(requestedPath);
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
        return null;
    }

    const absolutePath = path.resolve(assetsRoot, normalizedPath);
    const assetsDirectory = path.resolve(assetsRoot, 'assets');
    const relativePath = path.relative(assetsDirectory, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }

    return absolutePath;
}

function renderDisabledPage(title: string, message: string, transparent = false): string {
    const bodyStyle = transparent
        ? 'margin:0;background:transparent;color:#ffffff;font-family:Georgia,serif;'
        : 'margin:0;background:#101317;color:#ffffff;font-family:Georgia,serif;';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="${bodyStyle}"><div data-gui-disabled="true" style="padding:12px;opacity:0.9">${message}</div></body></html>`;
}

function renderActivePage(options: GuiPageOptions): string {
    const {
        title,
        runtimeKind,
        scriptKind = runtimeKind,
        transparent = false,
        includeEventGlobals = true,
        guiConfig
    } = options;
    const assetVersion = Date.now().toString(36);
    const bodyStyle = transparent
        ? 'margin:0;background:transparent;color:#ffffff;font-family:Georgia,serif;'
        : 'margin:0;background:#101317;color:#ffffff;font-family:Georgia,serif;';
    const runtimeGuiConfig = buildGuiRuntimeConfig(guiConfig);
    const runtimeGlobals = includeEventGlobals
        ? `window.__STREAM_SYNC_GUI_KIND__=${JSON.stringify(runtimeKind)};window.__STREAM_SYNC_GUI_EVENTS__='/gui/events';window.__STREAM_SYNC_GUI_CONFIG__=${JSON.stringify(runtimeGuiConfig)};`
        : `window.__STREAM_SYNC_GUI_KIND__=${JSON.stringify(runtimeKind)};`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/gui/assets/styles.css?v=${assetVersion}"></head><body style="${bodyStyle}"><div id="app" data-kind="${runtimeKind}"></div><script>${runtimeGlobals}</script><script type="module" src="/gui/assets/${scriptKind}.js?v=${assetVersion}"></script></body></html>`;
}

function sendNotFound(res: ServerResponse<IncomingMessage>): void {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
}

function sendMethodNotAllowed(res: ServerResponse<IncomingMessage>, allow = 'GET, HEAD'): void {
    res.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: allow
    });
    res.end('Method Not Allowed');
}

function isGetRequest(req: IncomingMessage): boolean {
    return (req.method ?? 'GET').toUpperCase() === 'GET';
}

function isHeadRequest(req: IncomingMessage): boolean {
    return (req.method ?? 'GET').toUpperCase() === 'HEAD';
}

function requireGetRequest(req: IncomingMessage, res: ServerResponse<IncomingMessage>, allow = 'GET, HEAD'): boolean {
    if (isGetRequest(req) || isHeadRequest(req)) {
        return true;
    }

    sendMethodNotAllowed(res, allow);
    return false;
}

function sendNoCacheHtml(res: ServerResponse<IncomingMessage>, html: string, sendBody = true): void {
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(sendBody ? html : undefined);
}

function sendStaticAsset(res: ServerResponse<IncomingMessage>, assetPath: string, sendBody = true): void {
    res.writeHead(200, {
        'Content-Type': getAssetContentType(assetPath),
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(sendBody ? fs.readFileSync(assetPath) : undefined);
}

export {
    getAssetContentType,
    isHeadRequest,
    renderActivePage,
    renderDisabledPage,
    requireGetRequest,
    resolveAssetFilePath,
    sendMethodNotAllowed,
    sendNoCacheHtml,
    sendNotFound,
    sendStaticAsset
};
