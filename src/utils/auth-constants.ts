type TimeoutOperation = 'tokenValidation' | 'tokenRefresh' | 'oauthValidation' | 'proactiveRefresh';
type TimeoutConfig = Record<TimeoutOperation, number>;
type CriticalityLevel = 'IMMEDIATE' | 'HIGH' | 'NORMAL' | 'LOW';

const TOKEN_REFRESH_CONFIG = {
    OAUTH_TIMEOUT_MS: 10 * 60 * 1000
};

const OAUTH_SERVER_CONFIG = {
    DEFAULT_PORT: 3000,
    PORT_RANGE: {
        START: 3000,
        END: 3100
    },
    SSL_OPTIONS: {
        DAYS: 365,
        KEY_SIZE: 2048,
        ALGORITHM: 'sha256'
    }
};

const STREAMING_TIMEOUT_CONFIG: Record<CriticalityLevel, TimeoutConfig> = {
    IMMEDIATE: {
        tokenValidation: 2000,
        tokenRefresh: 3000,
        oauthValidation: 2000,
        proactiveRefresh: 1500
    },
    HIGH: {
        tokenValidation: 3000,
        tokenRefresh: 4000,
        oauthValidation: 3000,
        proactiveRefresh: 2500
    },
    NORMAL: {
        tokenValidation: 3000,
        tokenRefresh: 5000,
        oauthValidation: 3000,
        proactiveRefresh: 3000
    },
    LOW: {
        tokenValidation: 5000,
        tokenRefresh: 8000,
        oauthValidation: 5000,
        proactiveRefresh: 5000
    }
};

type OperationContext = {
    userInitiated?: boolean;
    streamingActive?: boolean;
    viewerCount?: number;
    userWaiting?: boolean;
};

class AuthConstants {
    static getStreamingOptimizedTimeout(criticality = 'normal', operationType: string = 'tokenValidation'): number {
        const criticalityLevel = criticality.toUpperCase();
        const config = STREAMING_TIMEOUT_CONFIG[criticalityLevel as CriticalityLevel] || STREAMING_TIMEOUT_CONFIG.NORMAL;

        if (operationType in config) {
            return config[operationType as TimeoutOperation];
        }

        return config.tokenValidation;
    }

    static determineOperationCriticality(context: OperationContext = {}): 'immediate' | 'high' | 'normal' | 'low' {
        const {
            userInitiated = false,
            streamingActive = false,
            viewerCount = 0,
            userWaiting = false
        } = context;

        if (userInitiated || userWaiting) {
            return 'immediate';
        }

        if (streamingActive && viewerCount > 100) {
            return 'high';
        }

        if (streamingActive) {
            return 'normal';
        }

        return 'low';
    }
}

export {
    TOKEN_REFRESH_CONFIG,
    OAUTH_SERVER_CONFIG,
    AuthConstants
};
