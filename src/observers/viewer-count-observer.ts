
class ViewerCountObserver {
    async onViewerCountUpdate(update) {
        throw new Error('ViewerCountObserver.onViewerCountUpdate() must be implemented by subclass');
    }

    async onStreamStatusChange(statusUpdate) {
        throw new Error('ViewerCountObserver.onStreamStatusChange() must be implemented by subclass');
    }

    async initialize() {
        // Default implementation - can be overridden
    }

    async cleanup() {
        // Default implementation - can be overridden
    }

    getObserverId() {
        throw new Error('ViewerCountObserver.getObserverId() must be implemented by subclass');
    }
}

module.exports = { ViewerCountObserver };