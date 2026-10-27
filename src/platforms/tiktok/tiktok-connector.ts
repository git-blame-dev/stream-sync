import type { TikTokLiveConstructorConnectionOptions, WebSocketParams, WebcastGotHttpConfig } from 'tiktok-live-connector';

/** A new SDK and HTTP cancellation scope for each application-owned connection attempt. */
async function createTikTokConnector(username: string, apiKey: string | null, signal: AbortSignal) {
    const { TikTokLiveConnection, WebcastDeserializeConfig } = await import('tiktok-live-connector');
    const { default: EulerStreamApiClient } = await import('tiktok-live-api-sdk');
    signal.throwIfAborted();
    WebcastDeserializeConfig.showBase64OnDecodeError = false;
    let signingStatus: number | null = null;
    const preserveSigningStatus = (error: Error) => {
        const code = signingStatus === 401 ? 4401 : signingStatus === 403 ? 4403 : signingStatus === 429 ? 4429 : null;
        return code ? Object.assign(new Error('TikTok signing request failed'), { code }) : error;
    };
    class ScopedConnection extends TikTokLiveConnection {
        constructor(name: string, constructorOptions: TikTokLiveConstructorConnectionOptions) {
            super(name, constructorOptions);
            const provideSocket = this._wsClientProvider;
            this._wsClientProvider = params => {
                signal.throwIfAborted();
                return provideSocket(params);
            };
        }
        override async connect(roomId?: string) {
            try { return await super.connect(roomId); }
            catch (error) { throw preserveSigningStatus(error instanceof Error ? error : new Error('TikTok connection failed')); }
        }
        protected override handleError(error: Error, context: string) {
            super.handleError(preserveSigningStatus(error), context);
        }
        protected override async setupWebsocket(url: string, params: WebSocketParams, roomId: string) {
            signal.throwIfAborted();
            const target = new URL(url);
            if (target.protocol !== 'wss:' || target.username || target.password
                || !['.tiktok.com', '.tiktokv.com'].some(suffix => target.hostname.endsWith(suffix))) {
                throw new Error('Invalid TikTok WebSocket destination');
            }
            await super.setupWebsocket(url, params, roomId);
        }
    }
    const options: TikTokLiveConstructorConnectionOptions = {
        eulerApiInstance: new EulerStreamApiClient({ ...(apiKey ? { apiKey } : {}), baseOptions: { signal, timeout: 15000, validateStatus: (status: number) => {
            signingStatus = status;
            return true;
        } } }),
        processInitialData: false,
        enableExtendedGiftInfo: false,
        // The SDK creates its cookie jar internally despite requiring it in this option type.
        webClientOptions: { signal, retry: { limit: 0 } } as unknown as WebcastGotHttpConfig,
        wsClientOptions: { handshakeTimeout: 15000, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false },
    };
    return new ScopedConnection(username, options);
}

export { createTikTokConnector };
