import { Readable, Writable } from 'node:stream';
import type { ClientRequest, IncomingMessage, IncomingHttpHeaders } from 'node:http';
import type { RequestOptions } from 'node:https';

export interface ArchiveTestHop {
    status?: number;
    headers?: IncomingHttpHeaders;
    body?: Readable;
    requestError?: boolean;
}

/** External HTTP boundary only: actual Node streams, no downloader/filesystem mocks. */
export function archiveTestTransport(hops: ArchiveTestHop[]) {
    const requests: { url: URL; options: RequestOptions; request: Writable; response: Readable }[] = [];
    const request = (url: URL, options: RequestOptions, receive: (response: IncomingMessage) => void): ClientRequest => {
        if (requests.some(item => !item.request.closed || !item.response.closed)) throw new Error('Test transport overlapped hops');
        const hop = hops[requests.length];
        if (!hop) throw new Error('Unexpected test request');
        const response = Object.assign(hop.body ?? Readable.from([Buffer.from('synthetic ZIP bytes')]), {
            statusCode: hop.status ?? 200,
            headers: hop.headers ?? {}
        });
        response.on('error', () => undefined);
        const outgoing = new Writable({
            autoDestroy: false,
            write(_chunk, _encoding, done) { done(); },
            final(done) {
                done();
                queueMicrotask(() => {
                    if (outgoing.destroyed) return;
                    if (hop.requestError) outgoing.destroy(new Error('Synthetic transport failure'));
                    else receive(response as unknown as IncomingMessage);
                });
            },
            destroy(error, done) { response.destroy(); done(error); }
        });
        response.once('close', () => outgoing.destroy());
        requests.push({ url, options, request: outgoing, response });
        return outgoing as unknown as ClientRequest;
    };
    return { request, requests };
}
