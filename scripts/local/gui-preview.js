const EventEmitter = require('events');

const configModule = require('../../src/core/config');
const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const { safeSetInterval, safeSetTimeout } = require('../../src/utils/timeout-validator');

const PREVIEW_DURATION_MS = 30000;
const PREVIEW_INTERVAL_MS = 2000;
const TIKTOK_PREVIEW_CUSTOM_EMOTE_URL = 'https://onlinetools.com/images/examples-onlinewebptools/random-color-square.webp';
const PREVIEW_PLATFORM_ACCOUNTS = [
    {
        platform: 'twitch',
        username: 'test-twitch-account',
        userId: 'test-twitch-account-id'
    },
    {
        platform: 'youtube',
        username: 'test-youtube-account',
        userId: 'test-youtube-account-id'
    },
    {
        platform: 'tiktok',
        username: 'test-tiktok-account',
        userId: 'test-tiktok-account-id'
    }
];

class PreviewEventBus extends EventEmitter {
    subscribe(eventName, handler) {
        this.on(eventName, handler);
        return () => this.off(eventName, handler);
    }
}

function buildPreviewConfig(baseConfig) {
    const sourceConfig = baseConfig || configModule.config;
    return {
        ...sourceConfig,
        gui: {
            ...sourceConfig.gui,
            enableDock: true,
            enableOverlay: true
        }
    };
}

function buildPreviewRows(durationMs = PREVIEW_DURATION_MS, intervalMs = PREVIEW_INTERVAL_MS) {
    const eventTypes = [
        'chat',
        'platform:follow',
        'command',
        'greeting',
        'farewell',
        'platform:gift',
        'platform:raid',
        'platform:share',
        'platform:paypiggy',
        'platform:giftpaypiggy',
        'platform:envelope'
    ];

    const rowCount = Math.floor(durationMs / intervalMs);
    const rows = [];

    for (let index = 0; index < rowCount; index += 1) {
        const type = eventTypes[index % eventTypes.length];
        const account = PREVIEW_PLATFORM_ACCOUNTS[index % PREVIEW_PLATFORM_ACCOUNTS.length];
        const timestamp = `2024-01-01T00:00:${String(index).padStart(2, '0')}.000Z`;
        const baseData = {
            username: account.username,
            userId: account.userId,
            timestamp
        };

        if (type === 'chat') {
            if (account.platform === 'tiktok' && index === eventTypes.length) {
                rows.push({
                    type,
                    platform: account.platform,
                    data: {
                        ...baseData,
                        message: {
                            text: 'test message hello world this is a message to everyone how are we today?',
                            parts: [
                                {
                                    type: 'emote',
                                    platform: 'tiktok',
                                    emoteId: '1234512345123451234',
                                    imageUrl: TIKTOK_PREVIEW_CUSTOM_EMOTE_URL
                                },
                                {
                                    type: 'text',
                                    text: ' test message '
                                },
                                {
                                    type: 'emote',
                                    platform: 'tiktok',
                                    emoteId: '1234512345123451234',
                                    imageUrl: TIKTOK_PREVIEW_CUSTOM_EMOTE_URL
                                },
                                {
                                    type: 'text',
                                    text: ' hello world this is a message to everyone '
                                },
                                {
                                    type: 'emote',
                                    platform: 'tiktok',
                                    emoteId: '1234512345123451234',
                                    imageUrl: TIKTOK_PREVIEW_CUSTOM_EMOTE_URL
                                },
                                {
                                    type: 'text',
                                    text: ' how are we today?'
                                }
                            ]
                        }
                    }
                });
                continue;
            }

            rows.push({
                type,
                platform: account.platform,
                data: {
                    ...baseData,
                    message: `preview message ${index}`
                }
            });
            continue;
        }

        rows.push({
            type,
            platform: account.platform,
            data: {
                ...baseData,
                displayMessage: `preview ${type} ${index}`
            }
        });
    }

    return rows;
}

async function runGuiPreview(options = {}) {
    const config = buildPreviewConfig(options.baseConfig);
    const durationMs = Number.isInteger(options.durationMs) && options.durationMs > 0
        ? options.durationMs
        : PREVIEW_DURATION_MS;
    const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
        ? options.intervalMs
        : PREVIEW_INTERVAL_MS;

    const eventBus = options.eventBus || new PreviewEventBus();
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetIntervalImpl = options.safeSetIntervalImpl || safeSetInterval;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || safeSetTimeout;
    const stdout = options.stdout || process.stdout;

    const service = createGuiTransportServiceImpl({ config, eventBus, logger: null });

    await service.start();

    const host = config.gui.host;
    const port = config.gui.port;
    stdout.write(`GUI preview running for ${Math.floor(durationMs / 1000)}s\n`);
    stdout.write(`Dock URL: http://${host}:${port}/dock\n`);
    stdout.write(`Overlay URL: http://${host}:${port}/overlay\n`);

    const previewRows = buildPreviewRows(durationMs, intervalMs);
    let rowCursor = 0;

    const intervalHandle = safeSetIntervalImpl(() => {
        if (rowCursor >= previewRows.length) {
            return;
        }

        eventBus.emit('display:row', previewRows[rowCursor]);
        rowCursor += 1;
    }, intervalMs);

    await new Promise((resolve) => {
        safeSetTimeoutImpl(resolve, durationMs);
    });

    clearInterval(intervalHandle);
    await service.stop();
    stdout.write('GUI preview finished\n');
}

if (require.main === module) {
    runGuiPreview().catch((error) => {
        process.stderr.write(`GUI preview failed: ${error && error.message ? error.message : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    buildPreviewRows,
    buildPreviewConfig,
    runGuiPreview
};
