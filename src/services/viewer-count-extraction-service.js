
class ViewerCountExtractionService {
    constructor(innertubeService, dependencies = {}) {
        this.innertubeService = innertubeService;
        this.logger = dependencies.logger;
        
        // Inject or fallback to require (for gradual migration)
        this.YouTubeViewerExtractor = dependencies.YouTubeViewerExtractor || 
            require('../extractors/youtube-viewer-extractor').YouTubeViewerExtractor;
        
        // Configuration
        this.config = {
            timeout: dependencies.timeout || 8000,
            strategies: dependencies.strategies || ['view_text', 'video_details', 'basic_info'],
            debug: dependencies.debug || false,
            retries: dependencies.retries || 0
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
    
    async extractViewerCount(videoId, options = {}) {
        const startTime = Date.now();
        this.stats.totalRequests++;
        
        try {
            this.logger?.debug(`[ViewerCountExtraction] Extracting viewer count for: ${videoId}`, 'viewer-extraction');
            
            // Get video info through service layer
            const info = await this.innertubeService.getVideoInfo(videoId, {
                timeout: options.timeout || this.config.timeout,
                instanceKey: options.instanceKey
            });
            
            // Extract viewer count using dedicated extractor
            const extractionResult = this.YouTubeViewerExtractor.extractConcurrentViewers(info, {
                debug: options.debug !== undefined ? options.debug : this.config.debug,
                strategies: options.strategies || this.config.strategies
            });
            
            // Update statistics
            const responseTime = Date.now() - startTime;
            this._updateStats(extractionResult.success, responseTime);
            
            if (extractionResult.success) {
                this.logger?.debug(
                    `[ViewerCountExtraction] Successfully extracted ${extractionResult.count} viewers using ${extractionResult.strategy} for video ${videoId}`, 
                    'viewer-extraction'
                );
                
                return {
                    success: true,
                    count: extractionResult.count,
                    strategy: extractionResult.strategy,
                    videoId,
                    responseTime,
                    metadata: extractionResult.metadata
                };
            } else {
                this.logger?.debug(
                    `[ViewerCountExtraction] Failed to extract viewer count for ${videoId}. Strategies attempted: ${extractionResult.metadata?.strategiesAttempted?.join(', ') || 'unknown'}`, 
                    'viewer-extraction'
                );
                
                return {
                    success: false,
                    count: 0,
                    videoId,
                    responseTime,
                    error: 'Extraction failed',
                    metadata: extractionResult.metadata
                };
            }
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this._updateStats(false, responseTime, error);
            
            this.logger?.debug(`[ViewerCountExtraction] Error extracting viewer count for ${videoId}: ${error.message}`, 'viewer-extraction');
            
            return {
                success: false,
                count: 0,
                videoId,
                responseTime,
                error: error.message,
                errorType: error.constructor.name
            };
        }
    }
    
    async extractViewerCountsBatch(videoIds, options = {}) {
        const maxConcurrency = options.maxConcurrency || 3;
        const results = [];
        
        this.logger?.debug(`[ViewerCountExtraction] Batch extracting ${videoIds.length} videos with concurrency ${maxConcurrency}`, 'viewer-extraction');
        
        // Process in batches to avoid overwhelming the service
        for (let i = 0; i < videoIds.length; i += maxConcurrency) {
            const batch = videoIds.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(videoId => 
                this.extractViewerCount(videoId, options)
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Convert settled promises to results
            const processedResults = batchResults.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    return {
                        success: false,
                        count: 0,
                        videoId: batch[index],
                        error: result.reason?.message || 'Promise rejected',
                        errorType: 'Promise'
                    };
                }
            });
            
            results.push(...processedResults);
        }
        
        return results;
    }
    
    async getAggregatedViewerCount(videoIds, options = {}) {
        if (!videoIds || videoIds.length === 0) {
            return {
                success: true,
                totalCount: 0,
                successfulStreams: 0,
                failedStreams: 0,
                streams: []
            };
        }
        
        this.logger?.debug(`[ViewerCountExtraction] Aggregating viewer count from ${videoIds.length} streams`, 'viewer-extraction');
        
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
        
        this.logger?.debug(
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
    
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.logger?.debug('[ViewerCountExtraction] Configuration updated', 'viewer-extraction', this.config);
    }
    
    _updateStats(success, responseTime, error = null) {
        if (success) {
            this.stats.successfulExtractions++;
        } else {
            this.stats.failedExtractions++;
            
            if (error) {
                const errorType = error.constructor.name;
                this.stats.errorsByType[errorType] = (this.stats.errorsByType[errorType] || 0) + 1;
            }
        }
        
        // Update average response time
        const totalTime = this.stats.averageResponseTime * (this.stats.totalRequests - 1) + responseTime;
        this.stats.averageResponseTime = Math.round(totalTime / this.stats.totalRequests);
    }
}

module.exports = { ViewerCountExtractionService };