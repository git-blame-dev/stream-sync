
// Set test environment variables
process.env.NODE_ENV = 'test';

// Basic timeout
jest.setTimeout(10000);

// Simple console mocking without complex initialization
global.console = {
    log: jest.fn(),
    debug: jest.fn(),  
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
    dir: jest.fn(),
    time: jest.fn(),
    timeEnd: jest.fn(),
    group: jest.fn(),
    groupEnd: jest.fn(),
    table: jest.fn()
};

console.log('Jest setup minimal loaded successfully');
