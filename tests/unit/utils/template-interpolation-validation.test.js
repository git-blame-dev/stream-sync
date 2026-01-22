
const { describe, test, expect } = require('bun:test');

const { TEST_TIMEOUTS } = require('../../helpers/test-setup');

const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { interpolateTemplate } = require('../../../src/utils/notification-strings');
const { createNotificationData } = require('../../helpers/notification-test-utils');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('Template Interpolation Validation', () => {


    describe('interpolateTemplate Function', () => {
        test('should replace single template variable', () => {
            const template = 'Hello {username}!';
            const data = { username: 'TestUser' };
            
            const result = interpolateTemplate(template, data);
            
            expect(result).toBe('Hello TestUser!');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);

        test('should replace multiple template variables', () => {
            const template = '{username} sent {count} {item}';
            const data = { 
                username: 'TestUser', 
                count: 5, 
                item: 'roses' 
            };
            
            const result = interpolateTemplate(template, data);
            
            expect(result).toBe('TestUser sent 5 roses');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);

        test('should handle formattedGiftCountForDisplay variable specifically', () => {
            const template = '{username} sent {formattedGiftCountForDisplay}';
            const data = { 
                username: 'sample_handle',
                formattedGiftCountForDisplay: 'Subscription'
            };
            
            const result = interpolateTemplate(template, data);
            
            expect(result).toBe('sample_handle sent Subscription');
            expect(result).not.toContain('{formattedGiftCountForDisplay}');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);

        test('should throw when template variables are missing', () => {
            const template = '{username} sent {unknownVariable}';
            const data = { username: 'TestUser' };
            
            expect(() => interpolateTemplate(template, data)).toThrow('Missing template value');
        }, TEST_TIMEOUTS.FAST);

        test('should throw for empty template', () => {
            expect(() => interpolateTemplate('', { username: 'test' })).toThrow('Template must be a string');
        }, TEST_TIMEOUTS.FAST);

        test('should throw for null/undefined template', () => {
            expect(() => interpolateTemplate(null, { username: 'test' })).toThrow('Template must be a string');
            expect(() => interpolateTemplate(undefined, { username: 'test' })).toThrow('Template must be a string');
        }, TEST_TIMEOUTS.FAST);
    });


    describe('Template Data Population', () => {
        test('should populate formattedGiftCountForDisplay in interpolation data', () => {
            const userData = { username: 'testuser' };
            const eventData = { 
                giftCount: 1, 
                giftType: 'bits',
                amount: 100,
                currency: 'bits'
            };

            const result = createNotificationData('platform:gift', 'twitch', userData, eventData);

            expect(result.displayMessage).not.toContain('{formattedGiftCountForDisplay}');
            expect(result.displayMessage).toContain('testuser');
            expect(result.displayMessage).toMatch(/(bits|100)/i);
        }, TEST_TIMEOUTS.FAST);

        test('should populate multiple format variables for gift notifications', () => {
            const userData = { username: 'testuser' };
            const eventData = { 
                giftCount: 1, 
                giftType: 'bits',
                amount: 250,
                currency: 'bits'
            };

            const result = createNotificationData('platform:gift', 'twitch', userData, eventData);

            expect(result.displayMessage).not.toMatch(/\{.*\}/);
            expect(result.ttsMessage).not.toMatch(/\{.*\}/);

            expect(result.displayMessage).toContain('testuser');
            expect(result.displayMessage).toMatch(/(bits|250)/i);
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Comprehensive Template Variable Coverage', () => {
        const templateVariables = [
            'username',
            'ttsUsername', 
            'formattedGiftCount',
            'formattedGiftCountForDisplay',
            'formattedCoins',
            'formattedViewerCount',
            'formattedMonths'
        ];

        templateVariables.forEach(variable => {
            test(`should handle ${variable} template variable without exposing placeholder`, () => {
                const template = `{${variable}} test message`;
                const data = {
                    [variable]: 'TestValue'
                };

                const result = interpolateTemplate(template, data);

                expect(result).toBe('TestValue test message');
                expect(result).not.toContain(`{${variable}}`);
                expect(result).not.toMatch(/\{.*\}/);
            }, TEST_TIMEOUTS.FAST);
        });
    });

    describe('Real-World Template Patterns', () => {
        test('should handle gift notification template pattern', () => {
            const template = '{username} sent {formattedGiftCountForDisplay}';
            const data = {
                username: 'sample_handle',
                formattedGiftCountForDisplay: 'Subscription'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('sample_handle sent Subscription');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);

        test('should handle gift with coins template pattern', () => {
            const template = '{username} sent {formattedCoins} [{formattedGiftCountForDisplay}]';
            const data = {
                username: 'testuser',
                formattedCoins: '50 coins',
                formattedGiftCountForDisplay: 'Rose x 5'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testuser sent 50 coins [Rose x 5]');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);

        test('should handle follow notification template pattern', () => {
            const template = '{username} just followed!';
            const data = { username: 'newfollower' };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('newfollower just followed!');
            expect(result).not.toMatch(/\{.*\}/);
        }, TEST_TIMEOUTS.FAST);
    });
});
