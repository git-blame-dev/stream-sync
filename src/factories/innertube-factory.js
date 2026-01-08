
const { withTimeout } = require('../utils/timeout-wrapper');

// Logger will be loaded on-demand to avoid initialization issues

class InnertubeFactory {
    // Singleton pattern for caching the expensive YouTube.js import
    static _innertubeClassCache = null;
    static _importPromise = null;
    
    static async _getInnertubeClass() {
        if (this._innertubeClassCache) {
            return this._innertubeClassCache;
        }
        
        // Prevent duplicate imports if multiple calls happen simultaneously
        if (!this._importPromise) {
            this._importPromise = import('youtubei.js');
        }
        
        const youtubei = await this._importPromise;
        this._innertubeClassCache = youtubei.Innertube;
        return this._innertubeClassCache;
    }
    
    static async createInstance() {
        try {
            // Use cached Innertube class for performance
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create();
            
            // Standard Innertube instance created successfully
            return instance;
            
        } catch (error) {
            // Error handling - rethrow with context
            throw new Error(`Innertube creation failed: ${error.message}`);
        }
    }
    
    static async createWithConfig(config = {}) {
        try {
            
            // Use cached Innertube class for performance
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create(config);
            
            return instance;
            
        } catch (error) {
            throw new Error(`Innertube creation failed: ${error.message}`);
        }
    }
    
    static async createForTesting() {
        try {
            
            // Use cached Innertube class for performance
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create({
                // Test-specific configuration
                debug: false,
                cache: false
            });
            
            return instance;
            
        } catch (error) {
            throw new Error(`Innertube creation failed: ${error.message}`);
        }
    }
    
    static async createWithTimeout(timeoutMs = 10000, config = {}) {
        
        const createPromise = config && Object.keys(config).length > 0 ? 
            this.createWithConfig(config) : 
            this.createInstance();
        
        try {
            const instance = await withTimeout(
                createPromise,
                timeoutMs,
                {
                    operationName: 'Innertube creation',
                    errorMessage: `Innertube creation timeout (${timeoutMs}ms)`
                }
            );
            return instance;
        } catch (error) {
            throw error;
        }
    }
    
    static async getLazyInnertubeClass() {
        // Reuse existing DRY caching pattern - no code duplication
        return this._getInnertubeClass();
    }
    
    static createLazyReference() {
        // Return a function that uses our centralized lazy loading
        return () => this.getLazyInnertubeClass();
    }
    
    static getStats() {
        return {
            factoryVersion: '1.0.0',
            supportedMethods: ['createInstance', 'createWithConfig', 'createForTesting', 'createWithTimeout', 'getLazyInnertubeClass', 'createLazyReference'],
            youtubeJsVersion: 'v16+',
            esm: true,
            cached: !!this._innertubeClassCache
        };
    }
}

module.exports = { InnertubeFactory };
