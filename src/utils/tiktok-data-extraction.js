
const { formatTimestampCompact } = require('./text-processing');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const { validateLoggerInterface } = require('./dependency-validator');

function resolveLogger(candidate) {
    const candidates = [];

    if (candidate) {
        candidates.push(candidate);
    }

    if (global.__TEST_LOGGER__) {
        candidates.push(global.__TEST_LOGGER__);
    }

    try {
        const logging = require('../core/logging');
        const unified = typeof logging.getUnifiedLogger === 'function'
            ? logging.getUnifiedLogger()
            : logging.logger;
        if (unified) {
            candidates.push(unified);
        }
    } catch {
        // Logging may not be initialized yet; continue with other candidates
    }

    const selected = candidates.find(Boolean);
    if (!selected) {
        throw new Error('TikTok data extraction requires a logger dependency');
    }

    const normalized = normalizeLoggerMethods(selected);
    validateLoggerInterface(normalized);
    return normalized;
}

function normalizeLoggerMethods(logger) {
    const required = ['debug', 'info', 'warn', 'error'];
    const normalized = { ...logger };
    required.forEach((method) => {
        if (typeof normalized[method] !== 'function') {
            normalized[method] = () => {};
        }
    });
    return normalized;
}

function extractTikTokUserData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok user payload must be an object');
    }

    const userData = (data.user && typeof data.user === 'object') ? data.user : null;
    if (!userData) {
        throw new Error('TikTok user payload requires user object');
    }

    const userId = typeof userData.userId === 'string'
        ? userData.userId.trim()
        : (typeof userData.userId === 'number' ? String(userData.userId) : null);
    const username = typeof userData.uniqueId === 'string'
        ? userData.uniqueId.trim()
        : (typeof userData.uniqueId === 'number' ? String(userData.uniqueId) : null);

    if (!userId || !username) {
        throw new Error('TikTok user payload requires user.userId and user.uniqueId');
    }

    return {
        userId,
        username
    };
}

function extractTikTokGiftData(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('TikTok gift payload must be an object');
    }
    // TikTok gift data is in giftDetails (verified: present in 100% of 639 production samples)
    // giftDetails and extendedGiftInfo are both always present, but giftDetails has the
    // localized user-facing name, so we use it as the single source of truth
    const giftDetails = data.giftDetails;
    if (!giftDetails || typeof giftDetails !== 'object') {
        throw new Error('TikTok gift payload requires giftDetails');
    }
    if (typeof giftDetails.giftName !== 'string' || !giftDetails.giftName.trim()) {
        throw new Error('TikTok gift payload requires giftDetails.giftName');
    }
    if (typeof giftDetails.diamondCount !== 'number' || !Number.isFinite(giftDetails.diamondCount)) {
        throw new Error('TikTok gift payload requires giftDetails.diamondCount');
    }
    if (typeof giftDetails.giftType !== 'number' || !Number.isFinite(giftDetails.giftType)) {
        throw new Error('TikTok gift payload requires giftDetails.giftType');
    }
    if (typeof data.repeatCount !== 'number' || !Number.isFinite(data.repeatCount) || data.repeatCount <= 0) {
        throw new Error('TikTok gift payload requires repeatCount');
    }
    const comboType = giftDetails.giftType;
    const giftCount = data.repeatCount;
    const unitAmount = giftDetails.diamondCount;
    const amount = unitAmount * giftCount;

    return {
        // giftDetails.giftName is the user-facing localized name (e.g., "Popular Vote")
        // extendedGiftInfo.name is the generic English name (e.g., "Go Popular")
        // Use giftDetails as single source since it's always present (verified 639/639 samples)
        giftType: giftDetails.giftName,

        // repeatCount is at root level, always present (verified 639/639 samples, never 0)
        giftCount,
        amount,
        currency: 'coins',
        unitAmount,

        // Combo detection: comboType === 1 means combo-enabled gift
        // Use comboType as authoritative source, fallback to combo boolean if comboType missing
        combo: comboType === 1,
        comboType,

        // Combo metadata fields at root level
        groupId: data.groupId,
        repeatEnd: data.repeatEnd  // TikTok sends 0 or 1 (integer)
    };
}

function extractTikTokViewerCount(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    return Number.isFinite(data.viewerCount) ? data.viewerCount : null;
}

function formatCoinAmount(amount, currency = 'coins') {
    if (!Number.isFinite(Number(amount)) || amount <= 0) {
        return '';
    }
    const coinText = Number(amount) === 1 ? 'coin' : 'coins';
    const label = currency && typeof currency === 'string' ? currency : 'coins';
    if (label !== 'coins') {
        return ` [${amount} ${label}]`;
    }
    return ` [${amount} ${coinText}]`;
}

async function logTikTokGiftData(data, processedData, aggregationKey, options = {}) {
    const {
        logger: loggerCandidate = null,
        errorHandler = null,
        writer = null,
        configProvider = null
    } = options;
    const logger = resolveLogger(loggerCandidate);
    const safeErrorHandler = errorHandler || createPlatformErrorHandler(logger, 'tiktok');

    try {
        // Get configuration to check if gift logging is enabled
        let giftLoggingEnabled = false; // Default to disabled - opt-in only
        let giftLoggingPath = null;
        try {
            const configManager = configProvider || require('../core/config');
            const config = typeof configManager.getConfig === 'function'
                ? configManager.getConfig()
                : configProvider?.();
            if (config && config.tiktok && typeof config.tiktok.giftLoggingEnabled !== 'undefined') {
                giftLoggingEnabled = !!config.tiktok.giftLoggingEnabled;
            }
            if (config && config.tiktok && typeof config.tiktok.giftLoggingPath === 'string') {
                giftLoggingPath = config.tiktok.giftLoggingPath.trim() || null;
            }
        } catch {
            // If config access fails, leave logging disabled
        }

        if (!giftLoggingEnabled) {
            return;
        }

        // Always log to console for debugging (unless --no-msg flag is set)
        const shouldSuppressConsole = process.argv.includes("--no-msg");
        if (!shouldSuppressConsole) {
            logger.info(`[${formatTimestampCompact(new Date())}] [TikTok] [Gift Data] ${processedData.username} sent ${processedData.giftCount}x ${processedData.giftType} (${processedData.amount} ${processedData.currency}) - Key: ${aggregationKey}`);
        }

        if (!data?.giftDetails || typeof data.giftDetails !== 'object') {
            safeErrorHandler.handleDataLoggingError(
                new Error('TikTok gift logging requires giftDetails'),
                'tiktok-gift',
                'TikTok gift logging skipped: missing giftDetails'
            );
            return;
        }
        if (data.repeatCount === undefined || data.repeatCount === null) {
            safeErrorHandler.handleDataLoggingError(
                new Error('TikTok gift logging requires repeatCount'),
                'tiktok-gift',
                'TikTok gift logging skipped: missing repeatCount'
            );
            return;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            rawData: data,
            aggregationKey: aggregationKey,
            giftDetails: {
                giftName: data.giftDetails.giftName,
                giftCount: data.repeatCount,
                giftCoins: data.giftDetails.diamondCount,
                giftId: data.giftDetails.giftId,
                giftType: data.giftDetails.giftType,
                giftLevel: data.giftDetails.level,
                giftImage: data.giftDetails.image,
                giftDescription: data.giftDetails.description
            },
            userData: {
                userId: typeof data?.user?.userId === 'string'
                    ? data.user.userId
                    : (typeof data?.user?.userId === 'number' ? String(data.user.userId) : undefined),
                username: typeof data?.user?.uniqueId === 'string'
                    ? data.user.uniqueId
                    : (typeof data?.user?.uniqueId === 'number' ? String(data.user.uniqueId) : undefined),
                profilePicture: data?.user?.profilePictureUrl,
                followerCount: data?.user?.followerCount,
                followingCount: data?.user?.followingCount,
                isFollowing: data?.user?.isFollowing,
                isFollower: data?.user?.isFollower,
                isModerator: data?.user?.isModerator,
                isOwner: data?.user?.isOwner
            },
            eventData: {
                eventType: data?.eventType,
                eventId: data?.eventId,
                roomId: data?.roomId,
                streamId: data?.streamId,
                timestamp: data?.timestamp,
                sequence: data?.sequence
            },
            extendedInfo: {
                comboCount: data?.comboCount,
                repeatCount: data?.repeatCount,
                repeatEnd: data?.repeatEnd,
                comboId: data?.comboId,
                groupId: data?.groupId,
                priorityLevel: data?.priorityLevel,
                displayType: data?.displayType,
                isStreakable: data?.isStreakable,
                isStreaking: data?.isStreaking,
                streakableGiftId: data?.streakableGiftId,
                streakableGiftCount: data?.streakableGiftCount,
                streakableGiftComboCount: data?.streakableGiftComboCount,
                streakableGiftComboId: data?.streakableGiftComboId,
                streakableGiftComboEnd: data?.streakableGiftComboEnd
            }
        };

        try {
            if (writer) {
                await writer(JSON.stringify(logEntry));
                return;
            }

            if (!giftLoggingPath) {
                safeErrorHandler.handleDataLoggingError(
                    new Error('TikTok gift logging requires giftLoggingPath'),
                    'tiktok-gift',
                    'TikTok gift logging is enabled but no giftLoggingPath is configured'
                );
                return;
            }

            const path = require('path');
            const fs = require('fs/promises');
            const logFilePath = giftLoggingPath;
            await fs.mkdir(path.dirname(logFilePath), { recursive: true });
            await fs.appendFile(logFilePath, JSON.stringify(logEntry) + '\n');
        } catch (fileError) {
            safeErrorHandler.handleDataLoggingError(fileError, 'tiktok-gift', 'Error logging TikTok gift data');
        }

    } catch (err) {
        safeErrorHandler.handleDataLoggingError(err, 'tiktok-gift', 'Error in TikTok gift logging');
    }
}

module.exports = {
    extractTikTokUserData,
    extractTikTokGiftData,
    extractTikTokViewerCount,
    formatCoinAmount,
    logTikTokGiftData
}; 
