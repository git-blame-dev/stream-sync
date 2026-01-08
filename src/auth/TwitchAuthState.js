const { createPlatformErrorHandler } = require('../utils/platform-error-handler');


class TwitchAuthState {
    constructor(logger) {
        if (!logger || typeof logger.error !== 'function') {
            throw new Error('TwitchAuthState requires a logger');
        }
        this.state = 'READY'  // READY, REFRESHING, ERROR
        this.waitingOperations = []
        this.logger = logger
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-state')
    }
    
    async executeWhenReady(operation) {
        if (this.state === 'READY') {
            this.logger.debug?.('Auth is ready, executing operation immediately', 'auth-state')
            return await operation()
        }
        
        if (this.state === 'ERROR') {
            throw new Error('Authentication is in error state')
        }
        
        // Auth is refreshing, queue the operation
        this.logger.debug?.(`Auth is ${this.state}, queueing operation`, 'auth-state')
        return new Promise((resolve, reject) => {
            this.waitingOperations.push({ operation, resolve, reject })
        })
    }
    
    startRefresh() {
        this.logger.debug?.('Starting auth refresh, queueing new operations', 'auth-state')
        this.state = 'REFRESHING'
    }
    
    finishRefresh(success = true) {
        if (success) {
            this.state = 'READY'
            this.logger.debug?.(`Auth refresh completed successfully, executing ${this.waitingOperations.length} queued operations`, 'auth-state')
        } else {
            this.state = 'ERROR'
            this.logger.warn?.(`Auth refresh failed, rejecting ${this.waitingOperations.length} queued operations`, 'auth-state')
        }
        
        // Execute all waiting operations
        const operations = this.waitingOperations.splice(0)
        operations.forEach(async ({ operation, resolve, reject }) => {
            try {
                if (success) {
                    const result = await operation()
                    resolve(result)
                } else {
                    reject(new Error('Authentication refresh failed'))
                }
            } catch (error) {
                this._logStateError('Error executing queued operation', error)
                reject(error)
            }
        })
    }
    
    getState() {
        return this.state
    }
    
    getQueuedCount() {
        return this.waitingOperations.length
    }
    
    clearQueue() {
        const operations = this.waitingOperations.splice(0)
        operations.forEach(({ reject }) => {
            reject(new Error('Auth state reset, operation cancelled'))
        })
        this.logger.debug?.('Cleared all queued operations', 'auth-state')
    }
    
    reset() {
        this.clearQueue()
        this.state = 'READY'
        this.logger.debug?.('Auth state reset to READY', 'auth-state')
    }

    _logStateError(message, error) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'auth-state', null, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'auth-state', error);
        }
    }
}

module.exports = TwitchAuthState;
