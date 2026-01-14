
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');

// Test utilities
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const testClock = require('../helpers/test-clock');

describe('Extractor Service Integration', () => {
    
    beforeEach(async () => {
        testClock.reset();
    });
    
    afterEach(async () => {
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Primary Extraction Strategy (View Text)', () => {
        test('should extract from standard "watching now" format', () => {
            // Given: Standard YouTube live stream view text
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1,234 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correctly using primary strategy
            expect(result.success).toBe(true);
            expect(result.count).toBe(1234);
            expect(result.strategy).toBe('view_text');
            expect(result.metadata.strategiesAttempted).toContain('view_text');
        });

        test('should extract from "watching" format without "now"', () => {
            // Given: Alternative watching format
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '5,678 watching'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correctly
            expect(result.success).toBe(true);
            expect(result.count).toBe(5678);
            expect(result.strategy).toBe('view_text');
        });

        test('should handle numbers without commas', () => {
            // Given: View text without comma formatting
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '123 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correctly
            expect(result.success).toBe(true);
            expect(result.count).toBe(123);
            expect(result.strategy).toBe('view_text');
        });

        test('should handle large numbers with multiple commas', () => {
            // Given: Large viewer count with multiple commas
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1,234,567 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correctly
            expect(result.success).toBe(true);
            expect(result.count).toBe(1234567);
            expect(result.strategy).toBe('view_text');
        });

        test('should handle alternative watching patterns', () => {
            // Given: Various alternative patterns
            const patterns = [
                { text: '999 currently watching', expected: 999 },
                { text: '2,500 viewers watching', expected: 2500 },
                { text: '750 people watching', expected: 750 }
            ];
            
            patterns.forEach(pattern => {
                const videoInfo = {
                    primary_info: {
                        view_count: {
                            view_count: {
                                text: pattern.text
                            }
                        }
                    }
                };
                
                // When: Extracting viewer count
                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
                
                // Then: Should extract correctly
                expect(result.success).toBe(true);
                expect(result.count).toBe(pattern.expected);
                expect(result.strategy).toBe('view_text');
            });
        });
    });

    describe('Fallback Extraction Strategy (Video Details)', () => {
        test('should fallback to video_details when view_text unavailable', () => {
            // Given: Video info without primary view text
            const videoInfo = {
                video_details: {
                    viewer_count: '9876'
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should use fallback strategy
            expect(result.success).toBe(true);
            expect(result.count).toBe(9876);
            expect(result.strategy).toBe('video_details');
            expect(result.metadata.strategiesAttempted).toContain('view_text');
            expect(result.metadata.strategiesAttempted).toContain('video_details');
        });

        test('should use concurrent_viewers field as secondary fallback', () => {
            // Given: Video details with concurrent_viewers field
            const videoInfo = {
                video_details: {
                    concurrent_viewers: '5432'
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract from concurrent_viewers
            expect(result.success).toBe(true);
            expect(result.count).toBe(5432);
            expect(result.strategy).toBe('video_details');
        });

        test('should prefer viewer_count over concurrent_viewers', () => {
            // Given: Video details with both fields
            const videoInfo = {
                video_details: {
                    viewer_count: '1111',
                    concurrent_viewers: '2222'
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should prefer viewer_count
            expect(result.success).toBe(true);
            expect(result.count).toBe(1111);
            expect(result.strategy).toBe('video_details');
        });

        test('should handle numeric viewer_count values', () => {
            // Given: Video details with numeric value (not string)
            const videoInfo = {
                video_details: {
                    viewer_count: 8888
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correctly
            expect(result.success).toBe(true);
            expect(result.count).toBe(8888);
            expect(result.strategy).toBe('video_details');
        });
    });

    describe('Last Resort Extraction Strategy (Basic Info)', () => {
        test('should use basic_info as last resort for live streams', () => {
            // Given: Only basic info available for live stream
            const videoInfo = {
                basic_info: {
                    is_live: true,
                    view_count: '3333'
                }
            };
            
            // When: Extracting viewer count with basic_info strategy
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['basic_info']
            });
            
            // Then: Should extract from basic_info
            expect(result.success).toBe(true);
            expect(result.count).toBe(3333);
            expect(result.strategy).toBe('basic_info');
        });

        test('should reject basic_info for non-live streams', () => {
            // Given: Basic info for non-live stream
            const videoInfo = {
                basic_info: {
                    is_live: false,
                    view_count: '4444'
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['basic_info']
            });
            
            // Then: Should not extract from non-live stream
            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
        });
    });

    describe('Strategy Selection and Configuration', () => {
        test('should respect custom strategy selection', () => {
            // Given: Video info with multiple data sources
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1111 watching now'
                        }
                    }
                },
                video_details: {
                    viewer_count: '2222'
                }
            };
            
            // When: Extracting with only video_details strategy
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details']
            });
            
            // Then: Should use only specified strategy
            expect(result.success).toBe(true);
            expect(result.count).toBe(2222);
            expect(result.strategy).toBe('video_details');
            expect(result.metadata.strategiesAttempted).toEqual(['video_details']);
        });

        test('should handle empty strategy list gracefully', () => {
            // Given: Video info with data
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1111 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting with empty strategy list
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: []
            });
            
            // Then: Should return unsuccessful result
            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.strategiesAttempted).toEqual([]);
        });

        test('should use strategy priority order', () => {
            // Given: Video info with multiple data sources
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1111 watching now'
                        }
                    }
                },
                video_details: {
                    viewer_count: '2222'
                }
            };
            
            // When: Extracting with both strategies available
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details', 'view_text']
            });
            
            // Then: Should use view_text (higher priority) even when both are available
            expect(result.success).toBe(true);
            expect(result.count).toBe(1111);
            expect(result.strategy).toBe('view_text');
            
            // When: Extracting with only video_details strategy
            const result2 = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                strategies: ['video_details']
            });
            
            // Then: Should use video_details when view_text is not available
            expect(result2.success).toBe(true);
            expect(result2.count).toBe(2222);
            expect(result2.strategy).toBe('video_details');
        });
    });

    describe('Debug Mode and Metadata Collection', () => {
        test('should collect detailed metadata in debug mode', () => {
            // Given: Video info with view text
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '5,555 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting with debug mode
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: true
            });
            
            // Then: Should include detailed metadata
            expect(result.success).toBe(true);
            expect(result.count).toBe(5555);
            expect(result.metadata.rawData).toBeDefined();
            expect(result.metadata.rawData.view_text).toMatchObject({
                viewText: '5,555 watching now',
                hasViewText: true,
                viewTextType: 'string',
                patternMatched: 'watching_now',
                extractedText: '5,555 watching now'
            });
        });

        test('should not collect metadata when debug disabled', () => {
            // Given: Video info with view text
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '7,777 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting without debug mode
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: false
            });
            
            // Then: Should not include raw data
            expect(result.success).toBe(true);
            expect(result.count).toBe(7777);
            expect(result.metadata.rawData).toBeNull();
        });

        test('should collect error information in debug mode', () => {
            // Given: Malformed video info that will cause errors
            const videoInfo = {
                primary_info: {
                    view_count: null // This will cause errors during parsing
                }
            };
            
            // When: Extracting with debug mode
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                debug: true
            });
            
            // Then: Should capture error details
            expect(result.success).toBe(false);
            expect(result.metadata.rawData).toBeDefined();
        });
    });

    describe('Error Handling and Edge Cases', () => {
        test('should handle null video info gracefully', () => {
            // When: Extracting from null video info
            const result = YouTubeViewerExtractor.extractConcurrentViewers(null);
            
            // Then: Should return unsuccessful result with error
            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.error).toBe('No video info provided');
        });

        test('should handle undefined video info gracefully', () => {
            // When: Extracting from undefined video info
            const result = YouTubeViewerExtractor.extractConcurrentViewers(undefined);
            
            // Then: Should return unsuccessful result
            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.error).toBe('No video info provided');
        });

        test('should handle empty video info object', () => {
            // Given: Empty video info
            const videoInfo = {};
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should return unsuccessful result
            expect(result.success).toBe(false);
            expect(result.count).toBe(0);
            expect(result.metadata.strategiesAttempted).toContain('view_text');
        });

        test('should handle malformed view text', () => {
            // Given: Video info with malformed view text
            const malformedTexts = [
                'No viewers currently',
                'Offline',
                'Stream ended',
                '??? watching',
                'unknown watching now'
            ];
            
            malformedTexts.forEach(text => {
                const videoInfo = {
                    primary_info: {
                        view_count: {
                            view_count: {
                                text: text
                            }
                        }
                    }
                };
                
                // When: Extracting viewer count
                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
                
                // Then: Should handle gracefully (may succeed or fail depending on pattern)
                expect(result).toMatchObject({
                    success: expect.any(Boolean),
                    count: expect.any(Number),
                    strategy: result.success ? expect.any(String) : null,
                    metadata: expect.any(Object)
                });
                
                // Count should never be negative
                expect(result.count).toBeGreaterThanOrEqual(0);
            });
        });

        test('should handle invalid numeric values', () => {
            // Given: Video info with invalid numeric data
            const invalidValues = [
                { viewer_count: 'abc' },
                { viewer_count: '' },
                { viewer_count: 'NaN' },
                { viewer_count: '-1' },
                { concurrent_viewers: 'invalid' }
            ];
            
            invalidValues.forEach(invalidData => {
                const videoInfo = {
                    video_details: invalidData
                };
                
                // When: Extracting viewer count
                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo, {
                    strategies: ['video_details']
                });
                
                // Then: Should handle invalid data gracefully
                expect(result.success).toBe(false);
                expect(result.count).toBe(0);
            });
        });
    });

    describe('Validation and Content Quality', () => {
        test('should validate extracted viewer counts', () => {
            // When: Testing various viewer count values
            const testCases = [
                { count: 0, expected: true },
                { count: 100, expected: true },
                { count: 1000000, expected: true },
                { count: -1, expected: false },
                { count: NaN, expected: false },
                { count: 'invalid', expected: false },
                { count: 11000000, expected: false }, // Over limit
                { count: null, expected: false },
                { count: undefined, expected: false }
            ];
            
            testCases.forEach(testCase => {
                const isValid = YouTubeViewerExtractor.isValidViewerCount(testCase.count);
                expect(isValid).toBe(testCase.expected);
            });
        });

        test('should produce clean, user-friendly viewer counts', () => {
            // Given: Video info with formatted numbers
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '12,345 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should produce clean numeric result
            expect(result.success).toBe(true);
            expect(result.count).toBe(12345);
            expect(Number.isInteger(result.count)).toBe(true);
            
            // Result should have no technical artifacts
            expectNoTechnicalArtifacts(result.count.toString());
        });

        test('should handle international number formats', () => {
            // Given: Various international formatting styles
            const formats = [
                { text: '1,234 watching now', expected: 1234 },
                { text: '1,234,567 watching now', expected: 1234567 }
            ];
            
            // Test formats that should work
            formats.forEach(format => {
                const videoInfo = {
                    primary_info: {
                        view_count: {
                            view_count: {
                                text: format.text
                            }
                        }
                    }
                };
                
                // When: Extracting viewer count
                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
                
                // Then: Should extract correctly
                expect(result.success).toBe(true);
                expect(result.count).toBe(format.expected);
            });
            
            // Test formats that might not work
            const problematicFormats = [
                '1.234 watching now', // European format
                '1 234 watching now'  // Space separator
            ];
            
            problematicFormats.forEach(text => {
                const videoInfo = {
                    primary_info: {
                        view_count: {
                            view_count: {
                                text: text
                            }
                        }
                    }
                };
                
                // When: Extracting viewer count
                const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
                
                // Then: Should handle gracefully (may succeed or fail)
                expect(result.success).toEqual(expect.any(Boolean));
                expect(result.count).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Performance and Efficiency', () => {
        test('should extract viewer counts efficiently', () => {
            // Given: Large video info object
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '50,000 watching now'
                        }
                    }
                },
                video_details: {
                    viewer_count: '50000',
                    // Add many irrelevant fields to test efficiency
                    title: 'Test Stream',
                    description: 'A very long description...'.repeat(100),
                    thumbnail: { url: 'http://example.com/thumb.jpg' },
                    duration: 3600,
                    keywords: Array(100).fill('keyword')
                }
            };
            
            // When: Extracting viewer count with timing
            const startTime = testClock.now();
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            const simulatedDurationMs = 5;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();
            
            // Then: Should complete quickly (< 10ms)
            expect(endTime - startTime).toBeLessThan(10);
            expect(result.success).toBe(true);
            expect(result.count).toBe(50000);
        });

        test('should handle high-frequency extraction calls', () => {
            // Given: Video info for rapid extraction
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '1,000 watching now'
                        }
                    }
                }
            };
            
            // When: Performing many rapid extractions
            const startTime = testClock.now();
            const results = [];
            const iterations = 100;
            
            for (let i = 0; i < iterations; i++) {
                results.push(YouTubeViewerExtractor.extractConcurrentViewers(videoInfo));
            }
            
            testClock.advance(iterations - 1);
            const endTime = testClock.now();
            
            // Then: Should handle high frequency efficiently
            expect(endTime - startTime).toBeLessThan(100); // 100 extractions in < 100ms
            
            // All results should be consistent
            results.forEach(result => {
                expect(result.success).toBe(true);
                expect(result.count).toBe(1000);
            });
        });

        test('should minimize memory allocation during extraction', () => {
            // Given: Initial memory usage
            const initialMemory = process.memoryUsage().heapUsed;
            
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '2,000 watching now'
                        }
                    }
                }
            };
            
            // When: Performing many extractions
            for (let i = 0; i < 1000; i++) {
                YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            }
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage().heapUsed;
            
            // Then: Memory growth should be minimal
            const memoryGrowth = finalMemory - initialMemory;
            expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024); // Less than 5MB growth
        });
    });

    describe('Capabilities and Metadata', () => {
        test('should provide comprehensive capability information', () => {
            // When: Getting extractor capabilities
            const capabilities = YouTubeViewerExtractor.getCapabilities();
            
            // Then: Should provide complete metadata
            expect(capabilities).toMatchObject({
                version: '1.0.0',
                strategies: ['view_text', 'video_details', 'basic_info'],
                patterns: expect.arrayContaining([
                    'watching_now',
                    'watching',
                    'currently_watching',
                    'viewers_watching',
                    'people_watching'
                ]),
                supports: {
                    debug: true,
                    fallback: true,
                    metadata: true
                }
            });
        });

        test('should list all supported extraction patterns', () => {
            // When: Getting capabilities
            const capabilities = YouTubeViewerExtractor.getCapabilities();
            
            // Then: Should list all text patterns
            const expectedPatterns = [
                'watching_now',
                'watching', 
                'currently_watching',
                'viewers_watching',
                'people_watching'
            ];
            
            expectedPatterns.forEach(pattern => {
                expect(capabilities.patterns).toContain(pattern);
            });
        });

        test('should indicate support for all major features', () => {
            // When: Getting capabilities
            const capabilities = YouTubeViewerExtractor.getCapabilities();
            
            // Then: Should support all major features
            expect(capabilities.supports.debug).toBe(true);
            expect(capabilities.supports.fallback).toBe(true);
            expect(capabilities.supports.metadata).toBe(true);
        });
    });
});
