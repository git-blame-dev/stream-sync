declare module 'tiktok-live-connector';
declare module 'ini';

declare module 'ws' {
    class WebSocket {
        static OPEN: number;
        readyState: number;
        constructor(url: string, options?: unknown);
        on(eventName: string, handler: (...args: unknown[]) => void): void;
        ping(): void;
        close(code?: number, reason?: string): void;
        removeAllListeners(): void;
    }

    export { WebSocket };
    export default WebSocket;
}
