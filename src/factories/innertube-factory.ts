import { getUnifiedLogger } from '../core/logging';
import { withTimeout } from '../utils/timeout-wrapper';
import { installYouTubeParserLogAdapter } from '../utils/youtube-parser-log-adapter';
import { installYouTubeTextLogAdapter } from '../utils/youtube-text-log-adapter';

type InnertubeClassLike = {
    create: (config?: Record<string, unknown>) => Promise<unknown>;
};

type YouTubeModuleLike = {
    Innertube: InnertubeClassLike;
    [key: string]: unknown;
};

type InnertubeImporter = () => Promise<YouTubeModuleLike>;

class InnertubeFactory {
    static _innertubeClassCache: InnertubeClassLike | null = null;
    static _importPromise: Promise<YouTubeModuleLike> | null = null;
    static _importer: InnertubeImporter | null = null;

    static configure(options: { importer?: InnertubeImporter } = {}) {
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

        const importer = this._importer || (() => import('youtubei.js') as Promise<YouTubeModuleLike>);
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
            return await Innertube.create();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Innertube creation failed: ${errorMessage}`);
        }
    }

    static async createWithConfig(config: Record<string, unknown> = {}) {
        try {
            const Innertube = await this._getInnertubeClass();
            return await Innertube.create(config);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Innertube creation failed: ${errorMessage}`);
        }
    }

    static async createForTesting() {
        try {
            const Innertube = await this._getInnertubeClass();
            return await Innertube.create({
                debug: false,
                cache: false
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Innertube creation failed: ${errorMessage}`);
        }
    }

    static async createWithTimeout(timeoutMs = 10000, config: Record<string, unknown> = {}) {
        const createPromise = config && Object.keys(config).length > 0
            ? this.createWithConfig(config)
            : this.createInstance();

        return await withTimeout(
            createPromise,
            timeoutMs,
            {
                operationName: 'Innertube creation',
                errorMessage: `Innertube creation timeout (${timeoutMs}ms)`
            }
        );
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

export { InnertubeFactory };
