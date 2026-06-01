type ExtractionStrategy = 'view_text' | 'video_details' | 'basic_info';

type ExtractionResult = {
    count: number;
    strategy: ExtractionStrategy | null;
    success: boolean;
    metadata: {
        strategiesAttempted: string[];
        rawData: Record<string, unknown> | null;
        error?: string;
    };
};

type StrategyResult = {
    count: number;
    success: boolean;
    rawData: Record<string, unknown> | null;
};

const extractionStrategies = ['view_text', 'video_details', 'basic_info'] as const;

type ParseWatchingTextResult = {
    count: number;
    success: boolean;
    pattern: string | null;
    matchedText: string | null;
};

type VideoInfo = {
    primary_info?: {
        view_count?: {
            view_count?: {
                text?: unknown;
            };
        };
    };
    video_details?: {
        viewer_count?: unknown;
        concurrent_viewers?: unknown;
    };
    basic_info?: {
        is_live?: unknown;
        view_count?: unknown;
    };
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

class YouTubeViewerExtractor {
    
    static extractConcurrentViewers(videoInfo: VideoInfo, options: { debug?: boolean; strategies?: string[] } = {}): ExtractionResult {
        const debug = options.debug || false;
        const strategies = options.strategies || ['view_text', 'video_details'];
        
        const result: ExtractionResult = {
            count: 0,
            strategy: null,
            success: false,
            metadata: {
                strategiesAttempted: [],
                rawData: debug ? {} : null
            }
        };
        
        if (!videoInfo) {
            result.metadata.error = 'No video info provided';
            return result;
        }
        
        for (const strategy of strategies) {
            if (!this._isExtractionStrategy(strategy)) {
                continue;
            }

            const strategyResult = this._extractWithStrategy(strategy, videoInfo, debug);
            result.metadata.strategiesAttempted.push(strategy);

            if (debug && result.metadata.rawData && strategyResult.rawData) {
                result.metadata.rawData[strategy] = strategyResult.rawData;
            }

            if (strategyResult.success) {
                result.count = strategyResult.count;
                result.strategy = strategy;
                result.success = true;
                return result;
            }
        }
        
        return result;
    }

    static _isExtractionStrategy(strategy: string): strategy is ExtractionStrategy {
        return extractionStrategies.includes(strategy as ExtractionStrategy);
    }

    static _extractWithStrategy(strategy: ExtractionStrategy, videoInfo: VideoInfo, debug: boolean): StrategyResult {
        switch (strategy) {
            case 'view_text':
                return this._extractFromViewText(videoInfo, debug);
            case 'video_details':
                return this._extractFromVideoDetails(videoInfo, debug);
            case 'basic_info':
                return this._extractFromBasicInfo(videoInfo, debug);
        }
    }
    
    static _extractFromViewText(videoInfo: VideoInfo, debug = false): StrategyResult {
        const result: StrategyResult = {
            count: 0,
            success: false,
            rawData: debug ? {} : null
        };
        
        try {
            if (videoInfo.primary_info && 
                videoInfo.primary_info.view_count && 
                videoInfo.primary_info.view_count.view_count) {
                
                const viewText = videoInfo.primary_info.view_count.view_count.text;
                
                if (debug) {
                    result.rawData = {
                        viewText: viewText,
                        hasViewText: !!viewText,
                        viewTextType: typeof viewText
                    };
                }
                
                if (viewText && typeof viewText === 'string') {
                    const watchingMatch = this._parseWatchingText(viewText);
                    
                    if (watchingMatch.success) {
                        result.count = watchingMatch.count;
                        result.success = true;
                        
                        if (debug && result.rawData) {
                            result.rawData.patternMatched = watchingMatch.pattern;
                            result.rawData.extractedText = watchingMatch.matchedText;
                        }
                    }
                }
            }
        } catch (error: unknown) {
            if (debug) {
                result.rawData = {
                    ...(result.rawData || {}),
                    error: getErrorMessage(error)
                };
            }
        }
        
        return result;
    }
    
    static _extractFromVideoDetails(videoInfo: VideoInfo, debug = false): StrategyResult {
        const result: StrategyResult = {
            count: 0,
            success: false,
            rawData: debug ? {} : null
        };
        
        try {
            if (videoInfo.video_details) {
                if (debug) {
                    result.rawData = {
                        hasVideoDetails: true,
                        viewer_count: videoInfo.video_details.viewer_count,
                        concurrent_viewers: videoInfo.video_details.concurrent_viewers
                    };
                }
                
                if (videoInfo.video_details.viewer_count !== undefined) {
                    const count = this._parseStrictViewerCount(videoInfo.video_details.viewer_count);
                    if (count !== null) {
                        result.count = count;
                        result.success = true;
                        
                        if (debug && result.rawData) {
                            result.rawData.sourceField = 'viewer_count';
                        }
                        return result;
                    }
                }
                
                if (videoInfo.video_details.concurrent_viewers !== undefined) {
                    const count = this._parseStrictViewerCount(videoInfo.video_details.concurrent_viewers);
                    if (count !== null) {
                        result.count = count;
                        result.success = true;
                        
                        if (debug && result.rawData) {
                            result.rawData.sourceField = 'concurrent_viewers';
                        }
                    }
                }
            }
        } catch (error: unknown) {
            if (debug) {
                result.rawData = {
                    ...(result.rawData || {}),
                    error: getErrorMessage(error)
                };
            }
        }
        
        return result;
    }
    
    static _extractFromBasicInfo(videoInfo: VideoInfo, debug = false): StrategyResult {
        const result: StrategyResult = {
            count: 0,
            success: false,
            rawData: debug ? {} : null
        };
        
        try {
            if (videoInfo.basic_info) {
                if (debug) {
                    result.rawData = {
                        hasBasicInfo: true,
                        is_live: videoInfo.basic_info.is_live,
                        view_count: videoInfo.basic_info.view_count
                    };
                }
                
                if (!!videoInfo.basic_info.is_live && videoInfo.basic_info.view_count !== undefined && videoInfo.basic_info.view_count !== null) {
                    const count = this._parseStrictViewerCount(videoInfo.basic_info.view_count);
                    if (count !== null) {
                        result.count = count;
                        result.success = true;
                        
                        if (debug && result.rawData) {
                            result.rawData.sourceField = 'view_count';
                        }
                    }
                }
            }
        } catch (error: unknown) {
            if (debug) {
                result.rawData = {
                    ...(result.rawData || {}),
                    error: getErrorMessage(error)
                };
            }
        }
        
        return result;
    }

    static _parseStrictViewerCount(value: unknown): number | null {
        if (typeof value === 'number') {
            return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null;
        }

        if (typeof value !== 'string' || !/^\d+$/.test(value)) {
            return null;
        }

        const count = Number(value);
        return Number.isFinite(count) && Number.isInteger(count) ? count : null;
    }
    
    static _parseWatchingText(viewText: string): ParseWatchingTextResult {
        const result: ParseWatchingTextResult = {
            count: 0,
            success: false,
            pattern: null,
            matchedText: null
        };
        
        const patterns = [
            { name: 'watching_now', regex: /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+watching\s+now\s*$/i },
            { name: 'watching', regex: /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+watching\s*$/i },
            
            { name: 'currently_watching', regex: /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+currently\s+watching\s*$/i },
            { name: 'viewers_watching', regex: /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+viewers?\s+watching\s*$/i },
            { name: 'people_watching', regex: /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+people\s+watching\s*$/i }
        ];
        
        for (const pattern of patterns) {
            const match = viewText.match(pattern.regex);
            if (match && match[1]) {
                const countString = match[1].replace(/,/g, '');
                const count = this._parseStrictViewerCount(countString);
                
                if (count !== null) {
                    result.count = count;
                    result.success = true;
                    result.pattern = pattern.name;
                    result.matchedText = match[0];
                    break;
                }
            }
        }
        
        return result;
    }
    
    static isValidViewerCount(count: unknown): boolean {
        return typeof count === 'number' && 
               Number.isFinite(count) &&
               Number.isInteger(count) &&
               count >= 0 && 
               count <= 10000000;
    }
    
    static getCapabilities() {
        return {
            version: '1.0.0',
            strategies: ['view_text', 'video_details', 'basic_info'],
            patterns: [
                'watching_now',
                'watching', 
                'currently_watching',
                'viewers_watching',
                'people_watching'
            ],
            supports: {
                debug: true,
                fallback: true,
                metadata: true
            }
        };
    }
}

export { YouTubeViewerExtractor };
