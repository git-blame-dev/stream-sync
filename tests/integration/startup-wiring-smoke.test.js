const { describe, test, expect } = require('bun:test');

const path = require('path');
const { startApplication, logValidators } = require('../helpers/startup-test-utils');

describe('Startup wiring smoke', () => {
    test('starts cleanly with fixture config', async () => {
        const configPath = path.join(__dirname, '../fixtures/config.smoke.ini');
        const result = await startApplication('fast', [], {
            env: {
                CHAT_BOT_CONFIG_PATH: configPath,
                CHAT_BOT_STARTUP_ONLY: 'true'
            },
            timeout: 15000
        });

        expect(result.success).toBe(true);
        const validation = logValidators.validateNoErrors(result.logs);
        expect(validation.valid).toBe(true);
    }, { timeout: 20000 });
});
