// Simple Jest test to debug logging import issue
describe('Logging Import Test', () => {
    test('should import logging module successfully', () => {
        const logging = require('../src/core/logging');
        expect(typeof logging.setConfigValidator).toBe('function');
    });
    
    test('should call setConfigValidator successfully', () => {
        const logging = require('../src/core/logging');
        const mockConfig = () => ({ console: { enabled: false } });
        
        expect(() => {
            logging.setConfigValidator(mockConfig);
        }).not.toThrow();
    });
}); 