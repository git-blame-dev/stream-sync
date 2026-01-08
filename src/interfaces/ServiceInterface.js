
class ServiceInterface {
    async initialize(config) {
        throw new Error('initialize() must be implemented by service');
    }
    
    async start() {
        throw new Error('start() must be implemented by service');
    }
    
    async stop() {
        throw new Error('stop() must be implemented by service');
    }
    
    getStatus() {
        throw new Error('getStatus() must be implemented by service');
    }
    
    async pause() {
        // Default implementation - services can override if needed
        this.logger?.debug('Service paused');
    }
    
    async resume() {
        // Default implementation - services can override if needed
        this.logger?.debug('Service resumed');
    }
    
    validateConfiguration(config) {
        // Default implementation - basic validation
        return config && typeof config === 'object';
    }
    
    getMetrics() {
        return {
            service: this.constructor.name,
            uptime: Date.now() - (this.startTime || Date.now()),
            status: 'running'
        };
    }
}

module.exports = ServiceInterface;