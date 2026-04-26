import crypto from 'node:crypto';

import { DEFAULT_HTTP_USER_AGENTS } from '../../core/http-config';

type UserAgentLogger = {
    debug: (message: string, source?: string, data?: unknown) => void;
};

type UserAgentManagerOptions = {
    userAgents?: string[];
};

class YouTubeUserAgentManager {
    private logger: UserAgentLogger;
    private userAgents: string[];
    private currentIndex: number;
    private rotationCount: number;

    constructor(logger: UserAgentLogger, options: UserAgentManagerOptions = {}) {
        this.logger = logger;
        this.userAgents = Array.isArray(options.userAgents)
            ? options.userAgents.slice()
            : DEFAULT_HTTP_USER_AGENTS.slice();
        this.currentIndex = 0;
        this.rotationCount = 0;
    }

    getUserAgents(): string[] {
        return this.userAgents.slice();
    }

    setUserAgents(agents: unknown): void {
        if (!Array.isArray(agents)) {
            throw new Error('Invalid user agent format');
        }

        for (const agent of agents) {
            if (!this.isValidUserAgent(agent)) {
                throw new Error('Invalid user agent format');
            }
        }

        this.userAgents = agents.slice();
        this.currentIndex = 0;
        this.rotationCount = 0;
    }

    getNextUserAgent(): string {
        if (this.userAgents.length === 0) {
            return '';
        }

        const agent = this.userAgents[this.currentIndex];
        const previousIndex = this.currentIndex;

        this.currentIndex = (this.currentIndex + 1) % this.userAgents.length;
        if (previousIndex === this.userAgents.length - 1) {
            this.rotationCount++;
        }

        this.logger.debug('User-Agent rotation', 'youtube', {
            index: previousIndex,
            agent: `${agent.substring(0, 50)}...`,
            totalAgents: this.userAgents.length
        });

        return agent;
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    resetRotation(): void {
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

    getRandomUserAgent(): string {
        if (this.userAgents.length === 0) {
            return '';
        }

        const index = crypto.randomInt(this.userAgents.length);
        return this.userAgents[index];
    }

    isValidUserAgent(agent: unknown): agent is string {
        return typeof agent === 'string' && agent.length > 0;
    }

    addUserAgent(agent: unknown): void {
        if (this.isValidUserAgent(agent) && !this.userAgents.includes(agent)) {
            this.userAgents.push(agent);
        }
    }

    removeUserAgent(agent: string): void {
        const index = this.userAgents.indexOf(agent);
        if (index !== -1) {
            this.userAgents.splice(index, 1);
        }
    }
}

export {
    YouTubeUserAgentManager
};
