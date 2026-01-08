const crypto = require('crypto');
const { DEFAULT_HTTP_USER_AGENTS } = require('../core/http-config');

class YouTubeUserAgentManager {
        constructor(logger, options = {}) {
        /** @private */
        this.logger = logger;
        /** @private */
        this.userAgents = Array.isArray(options.userAgents)
            ? options.userAgents.slice()
            : DEFAULT_HTTP_USER_AGENTS.slice();
        /** @private */
        this.currentIndex = 0;
        /** @private */
        this.rotationCount = 0;
    }

        getUserAgents() {
        return this.userAgents.slice();
    }

        setUserAgents(agents) {
        if (!Array.isArray(agents)) {
            throw new Error('Invalid user agent format');
        }
        
        // Validate all agents
        for (const agent of agents) {
            if (!this.isValidUserAgent(agent)) {
                throw new Error('Invalid user agent format');
            }
        }
        
        this.userAgents = agents.slice();
        this.currentIndex = 0;
        this.rotationCount = 0;
    }

        getNextUserAgent() {
        if (this.userAgents.length === 0) return '';
        
        const agent = this.userAgents[this.currentIndex];
        const previousIndex = this.currentIndex;
        
        this.currentIndex = (this.currentIndex + 1) % this.userAgents.length;
        
        // Track full rotations
        if (previousIndex === this.userAgents.length - 1) {
            this.rotationCount++;
        }
        
        // Log rotation for debugging
        this.logger.debug('User-Agent rotation', 'youtube', {
            index: previousIndex,
            agent: agent.substring(0, 50) + '...',
            totalAgents: this.userAgents.length
        });
        
        return agent;
    }

        getCurrentIndex() {
        return this.currentIndex;
    }

        resetRotation() {
        this.currentIndex = 0;
        this.rotationCount = 0;
    }

        getStats() {
        return {
            totalAgents: this.userAgents.length,
            currentIndex: this.currentIndex,
            rotationCount: this.rotationCount
        };
    }

        getRandomUserAgent() {
        if (this.userAgents.length === 0) return '';
        const idx = crypto.randomInt(this.userAgents.length);
        return this.userAgents[idx];
    }

        isValidUserAgent(agent) {
        return typeof agent === 'string' && agent.length > 0;
    }

        addUserAgent(agent) {
        if (this.isValidUserAgent(agent) && !this.userAgents.includes(agent)) {
            this.userAgents.push(agent);
        }
    }

        removeUserAgent(agent) {
        const idx = this.userAgents.indexOf(agent);
        if (idx !== -1) {
            this.userAgents.splice(idx, 1);
        }
    }
}

module.exports = {
    YouTubeUserAgentManager
};
