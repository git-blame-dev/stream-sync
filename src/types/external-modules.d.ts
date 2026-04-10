declare module 'tiktok-live-connector';

type YouTubeLogAdapterLogger = {
    warn?: (message: unknown, source?: string, data?: unknown) => void;
    error?: (message: unknown, source?: string, data?: unknown) => void;
    debug?: (message: unknown, source?: string, data?: unknown) => void;
    info?: (message: unknown, source?: string, data?: unknown) => void;
};

type YouTubeParserApiLike = {
    setParserErrorHandler?: (handler: (context?: Record<string, unknown>) => void) => void;
};

declare module '*youtube-text-log-adapter' {
    function installYouTubeTextLogAdapter(options?: { logger?: YouTubeLogAdapterLogger }): {
        installed: boolean;
        reason: string;
    };

    export { installYouTubeTextLogAdapter };
}

declare module '*youtube-parser-log-adapter' {
    function installYouTubeParserLogAdapter(options?: {
        logger?: YouTubeLogAdapterLogger;
        youtubeModule?: { Parser?: YouTubeParserApiLike; [key: string]: unknown };
    }): {
        installed: boolean;
        reason: string;
    };

    export { installYouTubeParserLogAdapter };
}
