// Simple test to debug getViewerCount method in Jest

// Clear the global YouTube mock for this debug test
jest.unmock('../src/platforms/youtube');

describe('Debug YouTube getViewerCount', () => {
    it('should have getViewerCount method with proper provider pattern', async () => {
        const { YouTubePlatform } = require('../src/platforms/youtube');
        
        const mockConfig = {
            apiKey: 'test-api-key',
            channelId: 'test-channel-id',
            enabled: true,
            username: 'test-channel'
        };
        
        const mockDependencies = {
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            },
            notificationManager: {
                emit: jest.fn().mockImplementation((event, data) => true),
                on: jest.fn().mockImplementation((event, handler) => true),
                removeListener: jest.fn().mockImplementation((event, handler) => true)
            },
            streamDetectionService: {
                detectLiveStreams: jest.fn().mockResolvedValue({ success: true, videoIds: [] })
            }
        };
        
        console.log('Creating YouTube platform...');
        const youtube = new YouTubePlatform(mockConfig, mockDependencies);
        console.log('YouTube platform created');
        
        // Basic checks
        expect(youtube).toBeDefined();
        console.log('YouTube instance defined');
        expect(typeof youtube.getViewerCount).toBe('function');
        console.log('getViewerCount is function');
        
        // Test the viewer count provider pattern
        const initialViewerCountProvider = youtube.viewerCountProvider;
        
        console.log('Testing viewer count provider pattern...');
        
        // Call the method (should use provider pattern)
        const result = await youtube.getViewerCount();
        
        const debugInfo = {
            hasViewerCountProvider: !!youtube.viewerCountProvider,
            viewerCountProviderType: typeof youtube.viewerCountProvider,
            result: result,
            resultType: typeof result
        };
        
        console.log('Debug info:', debugInfo);
        
        // Test should validate the provider pattern works
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0); // Should return non-negative number
        
        // Validate provider pattern is in place
        expect(youtube.viewerCountProvider).toBeDefined();
        
        console.log(`getViewerCount returned: ${result} (provider pattern working)`);
    });
});
