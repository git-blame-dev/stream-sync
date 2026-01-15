
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../helpers/test-setup');

// Initialize logging for tests
initializeTestLogging();

const { YouTubeUserAgentManager } = require('../../src/utils/youtube-user-agent-manager');

describe('YouTube User-Agent Utility', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let userAgentManager;
    let mockLogger;

    beforeEach(() => {
        // Create mock logger
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Create user agent manager instance
        userAgentManager = new YouTubeUserAgentManager(mockLogger);
    });

    describe('User-Agent Management', () => {
        it('should initialize with default user agents', () => {
            expect(userAgentManager.getUserAgents()).toHaveLength(8);
            expect(userAgentManager.getUserAgents()[0]).toContain('Chrome/120');
            expect(userAgentManager.getUserAgents()[1]).toContain('Chrome/119');
        });

        it('should get next user agent in rotation', () => {
            const firstAgent = userAgentManager.getNextUserAgent();
            const secondAgent = userAgentManager.getNextUserAgent();
            
            expect(firstAgent).not.toBe(secondAgent);
            expect(userAgentManager.getUserAgents()).toContain(firstAgent);
            expect(userAgentManager.getUserAgents()).toContain(secondAgent);
        });

        it('should cycle through all user agents', () => {
            const agents = new Set();
            const totalAgents = userAgentManager.getUserAgents().length;
            
            // Get all agents in rotation
            for (let i = 0; i < totalAgents; i++) {
                agents.add(userAgentManager.getNextUserAgent());
            }
            
            expect(agents.size).toBe(totalAgents);
        });

        it('should reset to first agent after cycling through all', () => {
            const firstAgent = userAgentManager.getNextUserAgent();
            const totalAgents = userAgentManager.getUserAgents().length;
            
            // Cycle through all agents
            for (let i = 0; i < totalAgents - 1; i++) {
                userAgentManager.getNextUserAgent();
            }
            
            // Next call should return to the first agent
            const lastAgent = userAgentManager.getNextUserAgent();
            expect(lastAgent).toBe(firstAgent);
        });

        it('should allow custom user agents to be set', () => {
            const customAgents = [
                'Custom-Agent/1.0',
                'Custom-Agent/2.0'
            ];
            
            userAgentManager.setUserAgents(customAgents);
            
            expect(userAgentManager.getUserAgents()).toEqual(customAgents);
            expect(userAgentManager.getNextUserAgent()).toBe('Custom-Agent/1.0');
        });

        it('should validate user agent format', () => {
            const invalidAgents = ['', null, undefined];
            
            expect(() => {
                userAgentManager.setUserAgents(invalidAgents);
            }).toThrow('Invalid user agent format');
        });

        it('should log user agent rotation', () => {
            userAgentManager.getNextUserAgent();
            
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'User-Agent rotation',
                'youtube',
                expect.any(Object)
            );
        });

        it('should provide current user agent index', () => {
            expect(userAgentManager.getCurrentIndex()).toBe(0);
            
            userAgentManager.getNextUserAgent();
            expect(userAgentManager.getCurrentIndex()).toBe(1);
        });

        it('should allow resetting to first user agent', () => {
            userAgentManager.getNextUserAgent();
            userAgentManager.getNextUserAgent();
            
            expect(userAgentManager.getCurrentIndex()).toBe(2);
            
            userAgentManager.resetRotation();
            expect(userAgentManager.getCurrentIndex()).toBe(0);
        });

        it('should provide user agent statistics', () => {
            const stats = userAgentManager.getStats();
            
            expect(stats).toHaveProperty('totalAgents');
            expect(stats).toHaveProperty('currentIndex');
            expect(stats).toHaveProperty('rotationCount');
            expect(stats.totalAgents).toBe(8);
            expect(stats.currentIndex).toBe(0);
            expect(stats.rotationCount).toBe(0);
        });

        it('should track rotation count', () => {
            const totalAgents = userAgentManager.getUserAgents().length;
            
            // Complete one full rotation
            for (let i = 0; i < totalAgents; i++) {
                userAgentManager.getNextUserAgent();
            }
            
            expect(userAgentManager.getStats().rotationCount).toBe(1);
        });

        it('should handle empty user agent pools gracefully', () => {
            userAgentManager.setUserAgents([]);

            expect(userAgentManager.getNextUserAgent()).toBe('');
            expect(userAgentManager.getRandomUserAgent()).toBe('');
        });

        it('should ignore duplicate additions and allow removals', () => {
            const first = userAgentManager.getUserAgents()[0];
            userAgentManager.addUserAgent(first);
            expect(userAgentManager.getUserAgents().filter(a => a === first).length).toBe(1);

            userAgentManager.removeUserAgent(first);
            expect(userAgentManager.getUserAgents()).not.toContain(first);
        });

        it('should return empty string when pool becomes empty after removals', () => {
            const agents = userAgentManager.getUserAgents();
            agents.forEach(agent => userAgentManager.removeUserAgent(agent));

            expect(userAgentManager.getUserAgents()).toEqual([]);
            expect(userAgentManager.getNextUserAgent()).toBe('');
        });
    });

    describe('Integration with YouTube Platform', () => {
        it('should be compatible with existing YouTube platform usage', () => {
            // Simulate how the YouTube platform would use the manager
            const userAgent = userAgentManager.getNextUserAgent();
            
            expect(typeof userAgent).toBe('string');
            expect(userAgent.length).toBeGreaterThan(0);
            expect(userAgent).toContain('Mozilla');
        });

        it('should handle concurrent access safely', () => {
            const promises = [];
            
            // Simulate multiple concurrent requests
            for (let i = 0; i < 10; i++) {
                promises.push(Promise.resolve(userAgentManager.getNextUserAgent()));
            }
            
            return Promise.all(promises).then(agents => {
                // All agents should be valid
                agents.forEach(agent => {
                    expect(typeof agent).toBe('string');
                    expect(agent.length).toBeGreaterThan(0);
                });
            });
        });
    });
}); 
