declare module 'tiktok-live-connector';
declare module 'ini';

type YouTubeLogAdapterLogger = {
    warn?: (message: unknown, source?: string, data?: unknown) => void;
    error?: (message: unknown, source?: string, data?: unknown) => void;
    debug?: (message: unknown, source?: string, data?: unknown) => void;
    info?: (message: unknown, source?: string, data?: unknown) => void;
};

type YouTubeParserApiLike = {
    setParserErrorHandler?: (handler: (context?: Record<string, unknown>) => void) => void;
};

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


declare module '*spam-detection' {
    function createSpamDetectionConfig(config: unknown, options?: { logger?: unknown }): unknown;
    function createDonationSpamDetection(config: unknown, options?: Record<string, unknown>): unknown;

    export { createSpamDetectionConfig, createDonationSpamDetection };
}

declare module '*global-command-cooldown' {
    function clearExpiredGlobalCooldowns(maxAgeMs: number): number;

    export { clearExpiredGlobalCooldowns };
}

declare module '*tiktok-gift-animation/resolver' {
    function createTikTokGiftAnimationResolver(options?: { logger?: unknown }): {
        resolveFromNotificationData: (data: unknown) => Promise<{
            durationMs: number;
            mediaFilePath: string;
            mediaContentType: string;
            animationConfig: Record<string, unknown>;
        } | null>;
    };

    function getGiftAnimationDependencyStatus(): Record<string, unknown>;

    export { createTikTokGiftAnimationResolver };
    export { getGiftAnimationDependencyStatus };
}
