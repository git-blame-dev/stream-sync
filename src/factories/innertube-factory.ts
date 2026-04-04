
const { withTimeout } = require('../utils/timeout-wrapper');
const { getUnifiedLogger } = require('../core/logging');
const { installYouTubeParserLogAdapter } = require('../utils/youtube-parser-log-adapter');
const { installYouTubeTextLogAdapter } = require('../utils/youtube-text-log-adapter');

class InnertubeFactory {
    static _innertubeClassCache = null;
    static _importPromise = null;
    static _importer = null;

    static configure(options = {}) {
        if (options.importer && typeof options.importer !== 'function') {
            throw new Error('InnertubeFactory importer must be a function');
        }
        this._importer = options.importer || null;
        this._innertubeClassCache = null;
        this._importPromise = null;
    }
    
    static async _getInnertubeClass() {
        if (this._innertubeClassCache) {
            return this._innertubeClassCache;
        }
        
        const importer = this._importer || (() => import('youtubei.js'));
        if (!this._importPromise) {
            this._importPromise = importer();
        }
        
        const youtubei = await this._importPromise;
        const logger = getUnifiedLogger();
        installYouTubeTextLogAdapter({ logger });
        installYouTubeParserLogAdapter({
            logger,
            youtubeModule: youtubei
        });
        this._innertubeClassCache = youtubei.Innertube;
        return this._innertubeClassCache;
    }
    
    static async createInstance() {
        try {
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create();
            return instance;
        } catch (error) {
            throw new Error(`Innertube creation failed: ${error.message}`);
        }
    }
    
    static async createWithConfig(config = {}) {
        try {
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create(config);
            return instance;
        } catch (error) {
            throw new Error(`Innertube creation failed: ${error.message}`);
        }
    }
    
    static async createForTesting() {
        try {
            const Innertube = await this._getInnertubeClass();
            const instance = await Innertube.create({
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
        return this._getInnertubeClass();
    }
    
    static createLazyReference() {
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
