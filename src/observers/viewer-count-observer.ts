
class ViewerCountObserver {
    async onViewerCountUpdate(update: unknown) {
        throw new Error('ViewerCountObserver.onViewerCountUpdate() must be implemented by subclass');
    }

    async onStreamStatusChange(statusUpdate: unknown) {
        throw new Error('ViewerCountObserver.onStreamStatusChange() must be implemented by subclass');
    }

    async initialize() {
    }

    async cleanup() {
    }

    getObserverId() {
        throw new Error('ViewerCountObserver.getObserverId() must be implemented by subclass');
    }
}

export { ViewerCountObserver };
