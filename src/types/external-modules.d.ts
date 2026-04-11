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

declare module '*env-file-parser.js' {
    function parseEnvContent(content: string, options?: { ignoreEmptyKeys?: boolean }): Record<string, string>;

    export { parseEnvContent };
}

declare module '*logger-resolver.js' {
    function resolveLogger(loggerCandidate: unknown, fallbackContext: string): {
        debug?: (message: string, context?: string, payload?: unknown) => void;
        info?: (message: string, context?: string, payload?: unknown) => void;
        warn?: (message: string, context?: string, payload?: unknown) => void;
        error?: (message: string, context?: string, payload?: unknown) => void;
    };

    export { resolveLogger };
}

declare module '*file-logger.js' {
    class FileLogger {
        constructor(options: { logDir: string; filename: string });
        log(line: string): void;
    }

    export { FileLogger };
}

declare module '*text-processing.js' {
    function formatTimestampCompact(date: Date): string;
    function createTextProcessingManager(options?: { logger?: unknown }): unknown;

    export { formatTimestampCompact, createTextProcessingManager };
}

declare module '*text-processing' {
    function formatTimestampCompact(date: Date): string;
    function createTextProcessingManager(options?: { logger?: unknown }): unknown;

    export { formatTimestampCompact, createTextProcessingManager };
}

declare module '*NotificationManager.js' {
    export default class NotificationManager {
        constructor(...args: unknown[]);
        handleAggregatedDonation(data: unknown): void;
        donationSpamDetector?: unknown;
    }
}

declare module '*dependency-factory.js' {
    class DependencyFactory {
        constructor();
    }

    export { DependencyFactory };
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
    function getGiftAnimationDependencyStatus(): Record<string, unknown>;

    export { getGiftAnimationDependencyStatus };
}
