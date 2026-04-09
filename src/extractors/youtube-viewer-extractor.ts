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
        
        // Debug logging for troubleshooting when enabled  
        if (debug && console) {
            // Use proper logger instead for production debugging
        }
        
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
        
        // Strategy 1: Extract from view_count text (most reliable for live streams)
        if (strategies.includes('view_text')) {
            const viewTextResult = this._extractFromViewText(videoInfo, debug);
            result.metadata.strategiesAttempted.push('view_text');
            
            if (debug && result.metadata.rawData && viewTextResult.rawData) {
                result.metadata.rawData.view_text = viewTextResult.rawData;
            }
            
            if (viewTextResult.success) {
                result.count = viewTextResult.count;
                result.strategy = 'view_text';
                result.success = true;
                return result;
            }
        }
        
        // Strategy 2: Extract from video_details (backup method)
        if (strategies.includes('video_details') && !result.success) {
            const videoDetailsResult = this._extractFromVideoDetails(videoInfo, debug);
            result.metadata.strategiesAttempted.push('video_details');
            
            if (debug && result.metadata.rawData && videoDetailsResult.rawData) {
                result.metadata.rawData.video_details = videoDetailsResult.rawData;
            }
            
            if (videoDetailsResult.success) {
                result.count = videoDetailsResult.count;
                result.strategy = 'video_details';
                result.success = true;
                return result;
            }
        }
        
        // Strategy 3: Extract from basic_info (last resort)
        if (strategies.includes('basic_info') && !result.success) {
            const basicInfoResult = this._extractFromBasicInfo(videoInfo, debug);
            result.metadata.strategiesAttempted.push('basic_info');
            
            if (debug && result.metadata.rawData && basicInfoResult.rawData) {
                result.metadata.rawData.basic_info = basicInfoResult.rawData;
            }
            
            if (basicInfoResult.success) {
                result.count = basicInfoResult.count;
                result.strategy = 'basic_info';
                result.success = true;
                return result;
            }
        }
        
        return result;
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
                    // Primary pattern: "X watching" or "X watching now"
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
                
                // Try viewer_count field first
                if (videoInfo.video_details.viewer_count !== undefined) {
                    const count = parseInt(String(videoInfo.video_details.viewer_count), 10);
                    if (!isNaN(count) && count >= 0) {
                        result.count = count;
                        result.success = true;
                        
                        if (debug && result.rawData) {
                            result.rawData.sourceField = 'viewer_count';
                        }
                        return result;
                    }
                }
                
                // Try concurrent_viewers field as fallback
                if (videoInfo.video_details.concurrent_viewers !== undefined) {
                    const count = parseInt(String(videoInfo.video_details.concurrent_viewers), 10);
                    if (!isNaN(count) && count >= 0) {
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
                
                // Only extract if video is live
                if (!!videoInfo.basic_info.is_live && videoInfo.basic_info.view_count !== undefined && videoInfo.basic_info.view_count !== null) {
                    const count = parseInt(String(videoInfo.basic_info.view_count), 10);
                    if (!isNaN(count) && count >= 0) {
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
    
    static _parseWatchingText(viewText: string): ParseWatchingTextResult {
        const result: ParseWatchingTextResult = {
            count: 0,
            success: false,
            pattern: null,
            matchedText: null
        };
        
        const patterns = [
            // Primary patterns (most common)
            { name: 'watching_now', regex: /([0-9,]+)\s*watching\s*now/i },
            { name: 'watching', regex: /([0-9,]+)\s*watching/i },
            
            // Alternative patterns (rare edge cases)
            { name: 'currently_watching', regex: /([0-9,]+)\s*currently\s*watching/i },
            { name: 'viewers_watching', regex: /([0-9,]+)\s*viewers?\s*watching/i },
            { name: 'people_watching', regex: /([0-9,]+)\s*people\s*watching/i }
        ];
        
        for (const pattern of patterns) {
            const match = viewText.match(pattern.regex);
            if (match && match[1]) {
                const countString = match[1].replace(/,/g, ''); // Remove commas
                const count = parseInt(countString, 10);
                
                if (!isNaN(count) && count >= 0) {
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
               !isNaN(count) && 
               count >= 0 && 
               count <= 10000000; // Reasonable upper limit
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
