import { buildConfig } from '../../src/core/config-builders';
import { ConfigValidator } from '../../src/utils/config-validator';

/** Shared schema defaults without production configuration or credential lookup. */
function buildSyntheticGuiConfig() {
    return buildConfig(ConfigValidator.normalize({
        general: { envFileReadEnabled: false, envFileWriteEnabled: false },
        twitch: { enabled: false, dataLoggingEnabled: false },
        youtube: { enabled: false, dataLoggingEnabled: false },
        tiktok: { enabled: false, dataLoggingEnabled: false },
        vfx: { filePath: '' },
        logging: { fileLoggingEnabled: false }
    }, {}));
}

export { buildSyntheticGuiConfig };
