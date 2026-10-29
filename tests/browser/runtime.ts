// Load before production modules: browser workers must never discover local config/env files.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'ini';
import { getRawTestConfig } from '../helpers/config-fixture';
import { initializeLoggingConfig } from '../../src/core/logging';

const directory = mkdtempSync(join(tmpdir(), 'stream-sync-browser-config-'));
const config = getRawTestConfig();
config.logging = { fileLoggingEnabled: false };
const configPath = join(directory, 'synthetic-config.ini');
writeFileSync(configPath, stringify(config));
process.env.NODE_ENV = 'test';
process.env.CHAT_BOT_CONFIG_PATH = configPath;
initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
