import { logger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

const errorHandler = createPlatformErrorHandler(logger, 'user-tracking');
const TRACKED_PLATFORMS = new Set(['twitch', 'youtube', 'tiktok']);

type TrackingContext = {
    platform?: string;
    [key: string]: unknown;
};

function handleServiceError(message: string, error: unknown, context: TrackingContext = {}): void {
    if (errorHandler && error instanceof Error) {
        errorHandler.handleEventProcessingError(error, 'user-tracking', context, message);
        return;
    }

    errorHandler.logOperationalError(message, 'user-tracking', {
        ...context,
        error
    });
}

class UserTrackingService {
    seenUsers: Set<string>;
    private readonly streamSupportersByPlatform: Map<string, Set<string>>;
    private readonly pendingStreamSupportersByUsername: Map<string, Set<string>>;

    constructor() {
        this.seenUsers = new Set();
        this.streamSupportersByPlatform = new Map();
        this.pendingStreamSupportersByUsername = new Map();

    }

    private canonicalizePlatform(platform: unknown): string | null {
        if (typeof platform !== 'string') return null;
        const canonical = platform.trim().toLowerCase();
        return TRACKED_PLATFORMS.has(canonical) ? canonical : null;
    }

    private canonicalizeUserId(userId: unknown): string | null {
        if (typeof userId !== 'string') return null;
        const canonical = userId.trim();
        return canonical || null;
    }

    private canonicalizeUsername(username: unknown): string | null {
        if (typeof username !== 'string') return null;
        const canonical = username.trim().replace(/^@/, '').toLowerCase();
        return canonical || null;
    }

    markStreamSupporter(platform: unknown, userId: unknown): boolean {
        const canonicalPlatform = this.canonicalizePlatform(platform);
        const canonicalUserId = this.canonicalizeUserId(userId);
        if (!canonicalPlatform || !canonicalUserId) return false;
        let supporters = this.streamSupportersByPlatform.get(canonicalPlatform);
        if (!supporters) {
            supporters = new Set();
            this.streamSupportersByPlatform.set(canonicalPlatform, supporters);
        }
        supporters.add(canonicalUserId);
        return true;
    }

    isStreamSupporter(platform: unknown, userId: unknown): boolean {
        const canonicalPlatform = this.canonicalizePlatform(platform);
        const canonicalUserId = this.canonicalizeUserId(userId);
        if (!canonicalPlatform || !canonicalUserId) return false;
        return this.streamSupportersByPlatform.get(canonicalPlatform)?.has(canonicalUserId) === true;
    }

    markPendingStreamSupporter(platform: unknown, username: unknown): boolean {
        const canonicalPlatform = this.canonicalizePlatform(platform);
        const canonicalUsername = this.canonicalizeUsername(username);
        if (!canonicalPlatform || !canonicalUsername) return false;
        let pendingSupporters = this.pendingStreamSupportersByUsername.get(canonicalPlatform);
        if (!pendingSupporters) {
            pendingSupporters = new Set();
            this.pendingStreamSupportersByUsername.set(canonicalPlatform, pendingSupporters);
        }
        pendingSupporters.add(canonicalUsername);
        return true;
    }

    promotePendingStreamSupporter(platform: unknown, userId: unknown, username: unknown): boolean {
        const canonicalPlatform = this.canonicalizePlatform(platform);
        const canonicalUserId = this.canonicalizeUserId(userId);
        const canonicalUsername = this.canonicalizeUsername(username);
        if (!canonicalPlatform || !canonicalUserId || !canonicalUsername) return false;
        const pendingSupporters = this.pendingStreamSupportersByUsername.get(canonicalPlatform);
        if (!pendingSupporters?.delete(canonicalUsername)) return false;
        if (pendingSupporters.size === 0) {
            this.pendingStreamSupportersByUsername.delete(canonicalPlatform);
        }
        return this.markStreamSupporter(canonicalPlatform, canonicalUserId);
    }

    clearStreamSupporters(platform: unknown): void {
        const canonicalPlatform = this.canonicalizePlatform(platform);
        if (!canonicalPlatform) return;
        this.streamSupportersByPlatform.delete(canonicalPlatform);
        this.pendingStreamSupportersByUsername.delete(canonicalPlatform);
    }

hasSeenUser(userId: string | null | undefined, context: TrackingContext = {}): boolean {
        if (!userId) {
            logger.warn('No userId provided for seen-user check', 'user-tracking');
            return true;
        }

        try {
            return this.seenUsers.has(userId);
        } catch (error) {
            handleServiceError('[UserTrackingService] Error checking seen-user state', error, {
                userId,
                context
            });
            return true;
        }
    }

markMessageSeen(userId: string | null | undefined, context: TrackingContext = {}): boolean {
        if (!userId) {
            logger.warn('No userId provided for message tracking', 'user-tracking');
            return false;
        }

        try {
            this.seenUsers.add(userId);

            return true;
        } catch (error) {
            handleServiceError('[UserTrackingService] Error marking message as seen', error, {
                userId,
                context
            });
            return false;
        }
    }

isFirstMessage(userId: string | null | undefined, context: TrackingContext = {}): boolean {
        if (this.hasSeenUser(userId, context)) {
            return false;
        }

        return this.markMessageSeen(userId, context);
    }
}

function createUserTrackingService(): UserTrackingService {
    return new UserTrackingService();
}

export { UserTrackingService, createUserTrackingService };
