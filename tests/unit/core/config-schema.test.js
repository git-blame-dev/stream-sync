'use strict';

const { describe, expect, it } = require('bun:test');
const { CONFIG_SCHEMA, getFieldsRequiredWhenEnabled, buildDefaultsFromSchema, DEFAULTS } = require('../../../src/core/config-schema');

describe('buildDefaultsFromSchema()', () => {
    it('returns object with all sections from schema except dynamic', () => {
        const defaults = buildDefaultsFromSchema();
        const schemaSections = Object.keys(CONFIG_SCHEMA).filter(
            name => !CONFIG_SCHEMA[name]._dynamic
        );

        for (const sectionName of schemaSections) {
            expect(defaults).toHaveProperty(sectionName);
        }
        expect(defaults).not.toHaveProperty('commands');
    });

    it('extracts default values from field specs', () => {
        const defaults = buildDefaultsFromSchema();

        expect(defaults.general.debugEnabled).toBe(false);
        expect(defaults.general.messagesEnabled).toBe(true);
        expect(defaults.general.cmdCoolDown).toBe(60);
        expect(defaults.general.fallbackUsername).toBe('Unknown User');
    });

    it('skips fields without default (userDefined, inheritFrom)', () => {
        const defaults = buildDefaultsFromSchema();

        expect(defaults.youtube).not.toHaveProperty('viewerCountSource');
        expect(defaults.twitch).not.toHaveProperty('pollInterval');
        expect(defaults.tiktok).not.toHaveProperty('messagesEnabled');
    });

    it('includes all platform defaults', () => {
        const defaults = buildDefaultsFromSchema();

        expect(defaults.tiktok.enabled).toBe(false);
        expect(defaults.tiktok.viewerCountEnabled).toBe(true);
        expect(defaults.twitch.enabled).toBe(false);
        expect(defaults.twitch.tokenStorePath).toBe('./data/twitch-tokens.json');
        expect(defaults.youtube.enabled).toBe(false);
        expect(defaults.youtube.streamDetectionMethod).toBe('youtubei');
    });

    it('includes timing and handcam defaults', () => {
        const defaults = buildDefaultsFromSchema();

        expect(defaults.timing.fadeDuration).toBe(750);
        expect(defaults.timing.chatMessageDuration).toBe(4500);
        expect(defaults.handcam.enabled).toBe(false);
        expect(defaults.handcam.maxSize).toBe(50);
    });
});

describe('DEFAULTS constant', () => {
    it('has LOG_DIRECTORY set to ./logs', () => {
        expect(DEFAULTS.LOG_DIRECTORY).toBe('./logs');
    });

    it('includes all schema-derived defaults', () => {
        expect(DEFAULTS.general.debugEnabled).toBe(false);
        expect(DEFAULTS.obs.enabled).toBe(false);
        expect(DEFAULTS.spam.enabled).toBe(true);
    });

    it('matches buildDefaultsFromSchema() for all sections', () => {
        const generated = buildDefaultsFromSchema();

        for (const [sectionName, sectionDefaults] of Object.entries(generated)) {
            expect(DEFAULTS[sectionName]).toEqual(sectionDefaults);
        }
    });
});

describe('getFieldsRequiredWhenEnabled()', () => {
    it('returns username for tiktok', () => {
        const fields = getFieldsRequiredWhenEnabled('tiktok');
        expect(fields).toContain('username');
    });

    it('returns username, clientId, channel for twitch', () => {
        const fields = getFieldsRequiredWhenEnabled('twitch');
        expect(fields).toContain('username');
        expect(fields).toContain('clientId');
        expect(fields).toContain('channel');
    });

    it('returns username for youtube', () => {
        const fields = getFieldsRequiredWhenEnabled('youtube');
        expect(fields).toContain('username');
    });

    it('returns empty array for unknown section', () => {
        const fields = getFieldsRequiredWhenEnabled('nonexistent');
        expect(fields).toEqual([]);
    });
});
