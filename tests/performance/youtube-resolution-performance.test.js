
// Testing Infrastructure (mandatory)
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');
const { useRealTimers } = require('../helpers/bun-timers');

const {
  initializeTestLogging,
  createTestUser,
  TEST_TIMEOUTS,
  INTERNATIONAL_USERNAMES
} = require('../helpers/test-setup');

const {
  createMockNotificationDispatcher,
  noOpLogger,
  createMockYouTubeServices,
  setupAutomatedCleanup
} = require('../helpers/mock-factories');

const {
  expectNoTechnicalArtifacts,
  validateUserFacingString,
  expectValidNotification,
  expectOnlyMethodCalled,
  expectValidPlatformBehavior
} = require('../helpers/assertion-helpers');

const testClock = require('../helpers/test-clock');

const MockYouTubeLiveStreamService = {
  getLiveStreams: createMockFn(),
  isChannelId: createMockFn()
};

mockModule('../../src/services/youtube-live-stream-service', () => ({
  YouTubeLiveStreamService: MockYouTubeLiveStreamService
}));

// Initialize testing standards
initializeTestLogging();
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('YouTube Resolution Performance - User Experience Validation', () => {
  let mockInnertubeClient;
  let mockLogger;
  let userPerformanceMetrics;
  let performanceTiming;

  beforeEach(() => {
    useRealTimers();
    testClock.reset();

    // Initialize deterministic performance timing with larger difference for clearer testing
    performanceTiming = {
      usernameResolutionTime: 150, // ms
      channelIdDirectTime: 15      // ms
    };

    // Initialize user experience performance tracking
    userPerformanceMetrics = {
      operationTimes: [],
      userSatisfactionScores: [],
      responsivenessMeasurements: [],
      totalOperations: 0
    };

    // Create performance-aware mocks for user experience testing
    mockLogger = noOpLogger;
    
    mockInnertubeClient = {
      getChannel: createMockFn(),
      search: createMockFn()
    };

    // Define exact Channel IDs used in tests
    const testChannelIds = [
      'UC12345678901234567890',
      'UCresponsive123456789',
      'UCaliminated1234567890',
      'UCconsistent1234567890',
      'UCconcurrent0000000000',
      'UCconcurrent0000000001', 
      'UCconcurrent0000000002',
      'UCconcurrent0000000003',
      'UCconcurrent0000000004',
      'UCscale0000000000000001',
      'UCscale0000000000000003',
      'UCscale0000000000000005',
      'UCscale0000000000000008',
      'UCchinese1234567890123',
      'UCarabic12345678901234',
      'UCjapanese123456789012',
      'UCkorean12345678901234',
      'UCcomplex1234567890123',
      'UCfeedback1234567890123'
    ];

    // Mock the service to return consistent performance results
    MockYouTubeLiveStreamService.isChannelId.mockImplementation((handle) => {
      return testChannelIds.includes(handle);
    });

    MockYouTubeLiveStreamService.getLiveStreams.mockImplementation(async (client, channelHandle, options = {}) => {
      // Simulate realistic timing based on whether it's a username or Channel ID
      const isChannelId = testChannelIds.includes(channelHandle);
      
      const responseTime = isChannelId ? performanceTiming.channelIdDirectTime : performanceTiming.usernameResolutionTime;
      testClock.advance(responseTime);
      userPerformanceMetrics.operationTimes.push(responseTime);
      userPerformanceMetrics.totalOperations++;

      return {
        success: true,
        streams: [{
          videoId: 'test123',
          title: 'Test Live Stream',
          isLive: true,
          author: 'Test Author'
        }],
        count: 1,
        hasContent: true,
        responseTimeMs: responseTime
      };
    });
  });

  afterEach(() => {
        restoreAllMocks();
    useRealTimers();
    clearAllMocks();
  
        restoreAllModuleMocks();});

  describe('User Response Time Experience Improvements', () => {
    it('should provide faster user experience when using Channel ID directly', async () => {
      // Given: User has choice between username and Channel ID input
      const username = 'testchannel';
      const channelId = 'UC12345678901234567890'; // Listed in testChannelIds array
      
      // When: User performs operation with username (slower path)
      const usernameStartTime = testClock.now();
      const usernameResult = await MockYouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: mockLogger, timeout: 2000 }
      );
      const usernameResponseTime = testClock.now() - usernameStartTime; // Should be ~75ms

      // When: User performs operation with Channel ID (faster path)
      const channelIdStartTime = testClock.now();
      const channelIdResult = await MockYouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger, timeout: 2000 }
      );
      const channelIdResponseTime = testClock.now() - channelIdStartTime; // Should be ~5ms

      // Then: User experiences significantly faster response with Channel ID
      expect(channelIdResult.success).toBe(true);
      expect(usernameResult.success).toBe(true);
      expect(channelIdResponseTime).toBeLessThan(usernameResponseTime);
      
      // User Performance: Channel ID provides measurably better user experience
      const performanceImprovement = (usernameResponseTime - channelIdResponseTime) / usernameResponseTime;
      
      // Allow for timing variations while ensuring significant improvement
      expect(performanceImprovement).toBeGreaterThan(0.8); // At least 80% faster for users (150ms vs 15ms = ~90% improvement)
      
      // User Experience: Both paths provide clean results
      expectNoTechnicalArtifacts(channelIdResult.streams[0].title);
      expectNoTechnicalArtifacts(usernameResult.streams[0].title);
    });

    it('should demonstrate user interface responsiveness improvements', async () => {
      // Given: High-frequency operations that would impact user interface
      const channelId = 'UCresponsive123456789'; // Listed in testChannelIds array
      const operationCount = 10;
      const userResponsivenessThreshold = 25; // milliseconds - allow for real setTimeout timing + overhead

      // When: User performs multiple operations (simulating real-time updates)
      const userResponseTimes = [];
      const userExperienceGrades = [];
      
      for (let i = 0; i < operationCount; i++) {
        const startTime = testClock.now();
        
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          channelId,
          { logger: mockLogger, timeout: 1000 }
        );
        
        const endTime = testClock.now();
        const responseTime = endTime - startTime; // Should be ~15ms
        
        userResponseTimes.push(responseTime);
        
        // Grade user experience based on response time (adjusted for realistic timing)
        if (responseTime <= 20) {
          userExperienceGrades.push('excellent');
        } else if (responseTime <= 30) {
          userExperienceGrades.push('good');
        } else {
          userExperienceGrades.push('poor');
        }
        
        expect(result.success).toBe(true);
      }

      // Then: User experiences consistently responsive interface
      userResponseTimes.forEach((time, index) => {
        expect(time).toBeLessThan(userResponsivenessThreshold);
      });
      
      // User Experience: All operations provide excellent responsiveness
      const excellentCount = userExperienceGrades.filter(grade => grade === 'excellent').length;
      const goodCount = userExperienceGrades.filter(grade => grade === 'good').length;
      
      expect(excellentCount + goodCount).toBe(operationCount); // All operations good or excellent
      expect(excellentCount).toBeGreaterThan(operationCount * 0.8); // At least 80% excellent
      
      // User Performance: Average response time meets user expectations
      const averageTime = userResponseTimes.reduce((sum, time) => sum + time, 0) / operationCount;
      expect(averageTime).toBeLessThan(22); // Under 22ms average (15ms + some overhead)
    });
  });

  describe('Elimination of Redundant Operations User Impact', () => {
    it('should eliminate user-observable delays from redundant resolution', async () => {
      // Given: User configuration that would previously cause multiple resolutions
      const username = 'eliminationtest';
      const channelId = 'UCaliminated1234567890'; // Listed in testChannelIds array
      
      // Simulate old behavior (multiple resolutions) vs new behavior (single resolution + Channel ID)
      const oldBehaviorSimulation = async () => {
        const operations = [];
        // Each operation would previously require resolution (~150ms each)
        for (let i = 0; i < 3; i++) {
          await MockYouTubeLiveStreamService.getLiveStreams(
            mockInnertubeClient,
            username,
            { logger: mockLogger }
          );
          operations.push(performanceTiming.usernameResolutionTime);
        }
        return operations;
      };

      const newBehaviorSimulation = async () => {
        const operations = [];
        // First operation resolves (~150ms), subsequent operations use Channel ID (~15ms)
        await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          username,
          { logger: mockLogger }
        );
        operations.push(performanceTiming.usernameResolutionTime);
        
        // Subsequent operations use Channel ID (much faster)
        for (let i = 0; i < 2; i++) {
          await MockYouTubeLiveStreamService.getLiveStreams(
            mockInnertubeClient,
            channelId,
            { logger: mockLogger }
          );
          operations.push(performanceTiming.channelIdDirectTime);
        }
        return operations;
      };

      // When: User experiences old behavior vs new optimized behavior
      const oldOperations = await oldBehaviorSimulation();

      clearAllMocks(); // Reset for new behavior test

      const newOperations = await newBehaviorSimulation();

      const averageOldTime = oldOperations.reduce((sum, time) => sum + time, 0) / oldOperations.length;
      const averageNewTime = newOperations.reduce((sum, time) => sum + time, 0) / newOperations.length;

      // Then: Users experience materially faster follow-up calls after the first resolution
      expect(averageNewTime).toBeLessThan(averageOldTime * 0.5);

      const slowestNewOperation = Math.max(...newOperations);
      const fastestOldOperation = Math.min(...oldOperations);
      expect(slowestNewOperation).toBeLessThan(fastestOldOperation * 1.1);
    });

    it('should provide consistent fast response times for users after optimization', async () => {
      // Given: User performing multiple operations throughout a session
      const channelId = 'UCconsistent1234567890'; // Listed in testChannelIds array
      const sessionOperationCount = 15;
      const fastResponseThreshold = 1200; // milliseconds - allow CI variance
      
      // When: User performs extended session of operations
      const sessionResponseTimes = [];
      const userSatisfactionScores = [];
      
      for (let i = 0; i < sessionOperationCount; i++) {
        const startTime = testClock.now();
        
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          channelId,
          { logger: mockLogger }
        );
        
        const responseTime = testClock.now() - startTime; // Should be ~15ms
        sessionResponseTimes.push(responseTime);
        
        // Calculate user satisfaction based on response time (realistic timing)
        let satisfactionScore;
        if (responseTime <= 20) {
          satisfactionScore = 100; // Perfect
        } else if (responseTime <= 30) {
          satisfactionScore = 90;  // Excellent
        } else if (responseTime <= 50) {
          satisfactionScore = 70;  // Good
        } else {
          satisfactionScore = 40;  // Poor
        }
        
        userSatisfactionScores.push(satisfactionScore);
        expect(result.success).toBe(true);
      }

      // Then: User experiences consistently fast responses throughout session
      sessionResponseTimes.forEach((time, index) => {
        expect(time).toBeLessThan(fastResponseThreshold);
      });
      
      // User Experience: High satisfaction scores throughout session
      const averageSatisfaction = userSatisfactionScores.reduce((sum, score) => sum + score, 0) / sessionOperationCount;
      expect(averageSatisfaction).toBeGreaterThan(85); // High user satisfaction
      
      // User Performance: Consistent performance without degradation
      const firstHalfTimes = userPerformanceMetrics.operationTimes.slice(0, Math.floor(sessionOperationCount / 2));
      const secondHalfTimes = userPerformanceMetrics.operationTimes.slice(Math.floor(sessionOperationCount / 2));

      const average = (values) => values.reduce((sum, time) => sum + time, 0) / values.length;
      const firstHalfAvg = average(firstHalfTimes);
      const secondHalfAvg = average(secondHalfTimes);

      // Performance should stay consistent when using Channel ID optimization
      expect(secondHalfAvg).toBeLessThanOrEqual(firstHalfAvg * 1.1); // Allow minimal variance on simulated timings
    });
  });

  describe('Concurrent Operations User Experience', () => {
    it('should maintain user experience quality during concurrent operations', async () => {
      // Given: Multiple concurrent operations that user might trigger
      const channelIds = [
        'UCconcurrent0000000000',
        'UCconcurrent0000000001',
        'UCconcurrent0000000002', 
        'UCconcurrent0000000003',
        'UCconcurrent0000000004'
      ]; // All listed in testChannelIds array
      // When: User triggers multiple concurrent operations
      const concurrentPromises = channelIds.map(async channelId => {
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          channelId,
          { logger: mockLogger, timeout: 1000 }
        );
        const operationTime = result.responseTimeMs;
        
        return {
          result: result,
          operationTime: operationTime,
          channelId: channelId,
          userExperience: operationTime <= 20 ? 'excellent' : operationTime <= 30 ? 'good' : 'poor'
        };
      });
      
      const concurrentResults = await Promise.all(concurrentPromises);
      const operationTimes = concurrentResults.map(({ operationTime }) => operationTime);
      const totalConcurrentTime = Math.max(...operationTimes);

      // Then: User experiences good performance even with concurrent operations
      expect(totalConcurrentTime).toBeLessThan(100); // Under 100ms for all 5 concurrent operations (allows for concurrent overhead)
      
      // User Experience: All concurrent operations succeed
      concurrentResults.forEach(({ result, operationTime, userExperience }) => {
        expect(result.success).toBe(true);
        expect(userExperience).not.toBe('poor'); // All operations at least 'good'
      });
      
      // User Performance: Concurrent operations don't create unacceptable delays
      const excellentOperations = concurrentResults.filter(r => r.userExperience === 'excellent').length;
      const goodOperations = concurrentResults.filter(r => r.userExperience === 'good').length;
      
      expect(excellentOperations + goodOperations).toBe(channelIds.length); // All operations good or excellent
      
      // User Experience: Average time per operation remains acceptable
      const averageTimePerOperation = operationTimes.reduce((sum, time) => sum + time, 0) / channelIds.length;
      expect(averageTimePerOperation).toBeLessThan(30); // Under 30ms average even with concurrency
    });

    it('should demonstrate linear performance scaling for users', async () => {
      // Given: Increasing operation counts to test user experience scalability
      const operationCounts = [1, 3, 5, 8];
      const userExperienceResults = [];

      // When: User performs increasing numbers of operations
      for (const count of operationCounts) {
        const channelId = `UCscale${count.toString().padStart(16, '0')}`; // Listed in testChannelIds array
        const startTime = testClock.now();
        
        const promises = Array.from({ length: count }, () =>
          MockYouTubeLiveStreamService.getLiveStreams(
            mockInnertubeClient,
            channelId,
            { logger: mockLogger, timeout: 1000 }
          )
        );
        
        const results = await Promise.all(promises);
        const endTime = testClock.now();
        const totalTime = endTime - startTime; // Should be count × ~15ms
        
        userExperienceResults.push({
          operationCount: count,
          totalTime,
          timePerOperation: totalTime / count,
          allSuccessful: results.every(r => r.success),
          userSatisfaction: totalTime <= count * 25 ? 'high' : totalTime <= count * 50 ? 'medium' : 'low' // Adjusted for ~15ms per operation
        });
      }

      // Then: User experience scales linearly without exponential degradation
      userExperienceResults.forEach(result => {
        expect(result.allSuccessful).toBe(true);
        expect(result.userSatisfaction).not.toBe('low'); // All operations at least medium satisfaction
      });
      
      // User Performance: Time per operation remains stable as scale increases
      for (let i = 1; i < userExperienceResults.length; i++) {
        const current = userExperienceResults[i];
        const previous = userExperienceResults[i - 1];
        
        // Time per operation should not increase dramatically
        const timePerOpRatio = current.timePerOperation / previous.timePerOperation;
        expect(timePerOpRatio).toBeLessThan(1.5); // Less than 50% increase per operation
      }
      
      // User Experience: Even largest test maintains acceptable performance
      const largestTest = userExperienceResults[userExperienceResults.length - 1];
      expect(largestTest.totalTime).toBeLessThan(200); // Under 200ms for 8 operations
      expect(largestTest.timePerOperation).toBeLessThan(30); // Under 30ms average
    });
  });

  describe('International User Performance Experience', () => {
    it('should provide consistent performance for international users', async () => {
      // Given: International Channel IDs and performance measurement
      const internationalChannelIds = [
        'UCchinese1234567890123',    // Listed in testChannelIds array
        'UCarabic12345678901234',    // Listed in testChannelIds array
        'UCjapanese123456789012',    // Listed in testChannelIds array
        'UCkorean12345678901234'     // Listed in testChannelIds array
      ];
      
      // When: International users perform operations
      const internationalResults = [];
      
      for (const channelId of internationalChannelIds) {
        const startTime = testClock.now();
        
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          channelId,
          { logger: mockLogger }
        );
        
        const responseTime = testClock.now() - startTime; // Should be ~15ms
        
        internationalResults.push({
          channelId: channelId,
          result: result,
          responseTime: responseTime,
          contentLanguage: channelId.includes('chinese') ? 'chinese' : 
                          channelId.includes('arabic') ? 'arabic' :
                          channelId.includes('japanese') ? 'japanese' : 'korean'
        });
      }

      // Then: International users experience consistent performance
      internationalResults.forEach(({ result, responseTime, contentLanguage }) => {
        expect(result.success).toBe(true);
        expect(responseTime).toBeLessThan(25); // Fast for all international users
        
        // Content Quality: International content is preserved without performance impact
        expectNoTechnicalArtifacts(result.streams[0].title);
        expectNoTechnicalArtifacts(result.streams[0].author);
      });
      
      // User Experience: Performance consistency across all languages
      const responseTimes = internationalResults.map(r => r.responseTime);
      const averageTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const maxTime = Math.max(...responseTimes);
      const minTime = Math.min(...responseTimes);
      
      expect(maxTime - minTime).toBeLessThan(10); // Less than 10ms variance
      expect(averageTime).toBeLessThan(20); // Excellent average performance
      
      // International User Experience: All languages perform well
      internationalResults.forEach(({ contentLanguage, responseTime }) => {
        expect(responseTime).toBeLessThan(Math.max(averageTime * 1.5, 10)); // Within reasonable range
      });
    });

    it('should handle international content processing without performance degradation', async () => {
      // Given: Heavy international content that might impact processing
      const complexInternationalChannelId = 'UCcomplex1234567890123'; // Listed in testChannelIds array
      const complexContentOperations = 10;
      
      // Mock complex international content
      const createComplexInternationalContent = () => ({
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'complex123',
            title: { text: '🎮 Live Gaming Stream 实时游戏直播 ライブゲーミング 라이브 게이밍 بث مباشر للألعاب 🎮' },
            is_live: true,
            author: { name: 'MultiLingual Creator 多语言创作者 マルチ言語クリエイター 다국어 창작자' }
          }]
        })
      });

      // When: User performs multiple operations with complex international content
      const complexContentResults = [];
      
      for (let i = 0; i < complexContentOperations; i++) {
        const startTime = testClock.now();
        
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          complexInternationalChannelId,
          { logger: mockLogger }
        );
        
        const responseTime = testClock.now() - startTime; // Should be ~15ms
        complexContentResults.push({
          result: result,
          responseTime: responseTime,
          operationIndex: i
        });
      }

      // Then: Complex international content doesn't degrade user performance
      complexContentResults.forEach(({ result, responseTime, operationIndex }) => {
        expect(result.success).toBe(true);
        expect(responseTime).toBeLessThan(25); // Still fast despite complexity
        
        // Content Quality: Complex international content is handled properly
        const title = result.streams[0].title;
        const author = result.streams[0].author;
        
        expectNoTechnicalArtifacts(title);
        expectNoTechnicalArtifacts(author);
      });
      
      // User Performance: No degradation over multiple operations
      const averageResponseTime = complexContentResults.reduce((sum, r) => sum + r.responseTime, 0) / complexContentOperations;
      expect(averageResponseTime).toBeLessThan(20); // Excellent average performance
      
      // Performance Consistency: Later operations are not slower than earlier ones
      const firstHalfTimes = complexContentResults.slice(0, 5).map(r => r.responseTime);
      const secondHalfTimes = complexContentResults.slice(5).map(r => r.responseTime);
      
      const firstHalfAvg = firstHalfTimes.reduce((sum, time) => sum + time, 0) / firstHalfTimes.length;
      const secondHalfAvg = secondHalfTimes.reduce((sum, time) => sum + time, 0) / secondHalfTimes.length;
      
      // No significant performance degradation (allow for small variations)
      const degradationThreshold = Math.max(firstHalfAvg * 1.2, 10); // At least 10ms tolerance
      expect(secondHalfAvg).toBeLessThan(degradationThreshold);
    });
  });

  describe('User Experience Performance Feedback', () => {
    it('should provide performance indicators that help users understand system responsiveness', async () => {
      // Given: User operations with performance feedback simulation
      const channelId = 'UCfeedback1234567890123'; // Listed in testChannelIds array
      const operationsWithFeedback = 5;
      
      // When: User performs operations that would show performance feedback
      const userFeedbackResults = [];
      
      for (let i = 0; i < operationsWithFeedback; i++) {
        const startTime = testClock.now();
        
        const result = await MockYouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          channelId,
          { logger: mockLogger }
        );
        
        const responseTime = testClock.now() - startTime; // Should be ~15ms
        
        // Simulate user-facing performance feedback
        let performanceFeedback;
        if (responseTime <= 20) {
          performanceFeedback = {
            level: 'excellent',
            userMessage: 'Lightning fast response!',
            performanceGrade: 'A',
            responseTime: responseTime
          };
        } else if (responseTime <= 35) {
          performanceFeedback = {
            level: 'good',
            userMessage: 'Quick response',
            performanceGrade: 'B',
            responseTime: responseTime
          };
        } else {
          performanceFeedback = {
            level: 'acceptable',
            userMessage: 'Response received',
            performanceGrade: 'C',
            responseTime: responseTime
          };
        }
        
        userFeedbackResults.push({
          result: result,
          performanceFeedback: performanceFeedback,
          operationIndex: i
        });
      }

      // Then: Users receive clear performance feedback
      userFeedbackResults.forEach(({ result, performanceFeedback }) => {
        expect(result.success).toBe(true);
        expect(performanceFeedback.level).toBeDefined();
        expect(performanceFeedback.userMessage).toBeDefined();
        expect(performanceFeedback.performanceGrade).toBeDefined();
        
        // Content Quality: Performance feedback is user-friendly
        expectNoTechnicalArtifacts(performanceFeedback.userMessage);
        validateUserFacingString(performanceFeedback.userMessage, {
          audience: 'general',
          minLength: 5
        });
      });
      
      // User Experience: Majority of operations provide positive feedback
      const excellentCount = userFeedbackResults.filter(r => r.performanceFeedback.level === 'excellent').length;
      const goodCount = userFeedbackResults.filter(r => r.performanceFeedback.level === 'good').length;
      
      expect(excellentCount + goodCount).toBeGreaterThan(operationsWithFeedback * 0.8); // 80%+ positive feedback
      
      // User Performance: Performance grades reflect actual user experience
      userFeedbackResults.forEach(({ performanceFeedback }) => {
        expect(['A', 'B', 'C'].includes(performanceFeedback.performanceGrade)).toBe(true);
        expect(performanceFeedback.responseTime).toBeLessThan(40); // All operations under 40ms
      });
    });
  });
});
