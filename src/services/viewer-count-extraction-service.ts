import { YouTubeViewerExtractor } from '../extractors/youtube-viewer-extractor';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type ViewerExtractor = {
    extractConcurrentViewers: (
        videoInfo: Record<string, unknown>,
        options?: { debug?: boolean; strategies?: string[] }
    ) => {
        success: boolean;
        count: number;
        strategy?: string | null;
        metadata?: {
            strategiesAttempted?: string[];
            [key: string]: unknown;
        };
    };
};

type ServiceDependencies = {
    logger?: {
        debug?: (message: string, context?: string, payload?: unknown) => void;
    };
    timeout?: unknown;
    strategies?: unknown;
    debug?: unknown;
    retries?: unknown;
    YouTubeViewerExtractor?: ViewerExtractor;
};

type InnertubeServiceLike = {
    getVideoInfo: (videoId: string, options?: { timeout?: number; instanceKey?: unknown }) => Promise<Record<string, unknown>>;
};

type ExtractionConfig = {
    timeout: number;
    strategies: string[];
    debug: boolean;
    retries: number;
};

type ExtractionStats = {
    totalRequests: number;
    successfulExtractions: number;
    failedExtractions: number;
    averageResponseTime: number;
    errorsByType: Record<string, number>;
    startTime: number;
};

type ExtractViewerCountOptions = {
    timeout?: unknown;
    instanceKey?: unknown;
    debug?: unknown;
    strategies?: unknown;
    maxConcurrency?: unknown;
};

type ExtractionResponse = {
    success: boolean;
    count: number;
    videoId: string;
    responseTime?: number;
    strategy?: string | null;
    metadata?: Record<string, unknown>;
    error?: string;
    errorType?: string;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function getErrorType(error: unknown): string {
    if (error instanceof Error && error.constructor && typeof error.constructor.name === 'string') {
        return error.constructor.name;
    }

    return 'UnknownError';
}

function resolvePositiveNumber(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolveNonEmptyArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        return fallback;
    }

    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function resolveBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function resolveNonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

class ViewerCountExtractionService {
    innertubeService: InnertubeServiceLike;
    logger?: ServiceDependencies['logger'];
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    YouTubeViewerExtractor: ViewerExtractor;
    config: ExtractionConfig;
    stats: ExtractionStats;

    constructor(innertubeService: InnertubeServiceLike, dependencies: ServiceDependencies = {}) {
        this.innertubeService = innertubeService;
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'viewer-count-extraction');
        
        // Inject or fallback to core extractor
        this.YouTubeViewerExtractor = dependencies.YouTubeViewerExtractor || 
            YouTubeViewerExtractor;
        
        // Configuration
        this.config = {
            timeout: resolvePositiveNumber(dependencies.timeout, 8000),
            strategies: resolveNonEmptyArray(dependencies.strategies, ['view_text', 'video_details', 'basic_info']),
            debug: resolveBoolean(dependencies.debug, false),
            retries: resolveNonNegativeInteger(dependencies.retries, 0)
        };
        
        // Statistics for monitoring
        this.stats = {
            totalRequests: 0,
            successfulExtractions: 0,
            failedExtractions: 0,
            averageResponseTime: 0,
            errorsByType: {},
            startTime: Date.now()
        };
    }
    
    async extractViewerCount(videoId: string, options: ExtractViewerCountOptions = {}): Promise<ExtractionResponse> {
        const startTime = Date.now();
        this.stats.totalRequests++;
        
        try {
            this.logger?.debug?.(`[ViewerCountExtraction] Extracting viewer count for: ${videoId}`, 'viewer-extraction');
            
            // Get video info through service layer
            const info = await this.innertubeService.getVideoInfo(videoId, {
                timeout: resolvePositiveNumber(options.timeout, this.config.timeout),
                instanceKey: options.instanceKey
            });
            
            // Extract viewer count using dedicated extractor
            const extractionResult = this.YouTubeViewerExtractor.extractConcurrentViewers(info, {
                debug: resolveBoolean(options.debug, this.config.debug),
                strategies: resolveNonEmptyArray(options.strategies, this.config.strategies)
            });
            
            // Update statistics
            const responseTime = Date.now() - startTime;
            this._updateStats(extractionResult.success, responseTime);
            
            if (extractionResult.success) {
                this.logger?.debug?.(
                    `[ViewerCountExtraction] Successfully extracted ${extractionResult.count} viewers using ${extractionResult.strategy} for video ${videoId}`, 
                    'viewer-extraction'
                );
                
                return {
                    success: true,
                    count: extractionResult.count,
                    strategy: extractionResult.strategy,
                    videoId,
                    responseTime,
                    metadata: extractionResult.metadata as Record<string, unknown> | undefined
                };
            } else {
                this.logger?.debug?.(
                    `[ViewerCountExtraction] Failed to extract viewer count for ${videoId}. Strategies attempted: ${extractionResult.metadata?.strategiesAttempted?.join(', ') || 'unknown'}`, 
                    'viewer-extraction'
                );
                
                return {
                    success: false,
                    count: 0,
                    videoId,
                    responseTime,
                    error: 'Extraction failed',
                    metadata: extractionResult.metadata as Record<string, unknown> | undefined
                };
            }
            
        } catch (error: unknown) {
            const responseTime = Date.now() - startTime;
            this._updateStats(false, responseTime, error);
            
            this._handleExtractionError(`Error extracting viewer count for ${videoId}: ${getErrorMessage(error)}`, error);
            
            return {
                success: false,
                count: 0,
                videoId,
                responseTime,
                error: getErrorMessage(error),
                errorType: getErrorType(error)
            };
        }
    }
    
    async extractViewerCountsBatch(videoIds: string[], options: ExtractViewerCountOptions = {}): Promise<ExtractionResponse[]> {
        const maxConcurrency = resolveNonNegativeInteger(options.maxConcurrency, 3) || 3;
        const results: ExtractionResponse[] = [];
        
        this.logger?.debug?.(`[ViewerCountExtraction] Batch extracting ${videoIds.length} videos with concurrency ${maxConcurrency}`, 'viewer-extraction');
        
        // Process in batches to avoid overwhelming the service
        for (let i = 0; i < videoIds.length; i += maxConcurrency) {
            const batch = videoIds.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(videoId => 
                this.extractViewerCount(videoId, options)
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Convert settled promises to results
            const processedResults: ExtractionResponse[] = batchResults.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    return {
                        success: false,
                        count: 0,
                        videoId: batch[index] || '',
                        error: result.reason?.message || 'Promise rejected',
                        errorType: 'Promise'
                    };
                }
            });
            
            results.push(...processedResults);
        }
        
        return results;
    }
    
    async getAggregatedViewerCount(videoIds: string[], options: ExtractViewerCountOptions = {}) {
        if (!videoIds || videoIds.length === 0) {
            return {
                success: true,
                totalCount: 0,
                successfulStreams: 0,
                failedStreams: 0,
                streams: []
            };
        }
        
        this.logger?.debug?.(`[ViewerCountExtraction] Aggregating viewer count from ${videoIds.length} streams`, 'viewer-extraction');
        
        const results = await this.extractViewerCountsBatch(videoIds, options);
        
        // Aggregate results
        let totalCount = 0;
        let successfulStreams = 0;
        let failedStreams = 0;
        
        const streamDetails = results.map(result => {
            if (result.success && typeof result.count === 'number' && result.count >= 0) {
                totalCount += result.count;
                successfulStreams++;
            } else {
                failedStreams++;
            }
            
            return {
                videoId: result.videoId,
                count: result.count,
                success: result.success,
                strategy: result.strategy,
                error: result.error
            };
        });

        if (successfulStreams === 0) {
            this.logger?.debug?.(
                `[ViewerCountExtraction] Aggregation unavailable: 0/${videoIds.length} streams extracted successfully`,
                'viewer-extraction'
            );

            return {
                success: false,
                totalCount: 0,
                successfulStreams: 0,
                failedStreams,
                streams: streamDetails
            };
        }
        
        this.logger?.debug?.(
            `[ViewerCountExtraction] Aggregation complete: ${totalCount} total viewers from ${successfulStreams}/${videoIds.length} streams`, 
            'viewer-extraction'
        );
        
        return {
            success: true,
            totalCount,
            successfulStreams,
            failedStreams,
            streams: streamDetails
        };
    }
    
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime,
            successRate: this.stats.totalRequests > 0 ? 
                (this.stats.successfulExtractions / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%'
        };
    }
    
    updateConfig(newConfig: Record<string, unknown>) {
        this.config = { ...this.config, ...newConfig };
        this.logger?.debug?.('[ViewerCountExtraction] Configuration updated', 'viewer-extraction', this.config);
    }
    
    _updateStats(success: boolean, responseTime: number, error: unknown = null) {
        if (success) {
            this.stats.successfulExtractions++;
        } else {
            this.stats.failedExtractions++;
            
            if (error) {
                const errorType = getErrorType(error);
                this.stats.errorsByType[errorType] = (this.stats.errorsByType[errorType] || 0) + 1;
            }
        }
        
        // Update average response time
        const totalTime = this.stats.averageResponseTime * (this.stats.totalRequests - 1) + responseTime;
        this.stats.averageResponseTime = Math.round(totalTime / this.stats.totalRequests);
    }

    _handleExtractionError(message: string, error: unknown) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'viewer-extraction', null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'viewer-count-extraction');
        }
    }
}

export { ViewerCountExtractionService };
