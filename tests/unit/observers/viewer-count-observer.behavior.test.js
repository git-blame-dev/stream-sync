const { ViewerCountObserver } = require('../../../src/observers/viewer-count-observer');

describe('ViewerCountObserver behavior', () => {
    it('enforces required methods by default', async () => {
        const observer = new ViewerCountObserver();

        await expect(observer.onViewerCountUpdate({})).rejects.toThrow('must be implemented');
        await expect(observer.onStreamStatusChange({})).rejects.toThrow('must be implemented');
        expect(() => observer.getObserverId()).toThrow('must be implemented');
    });

    it('allows optional initialize/cleanup to no-op by default', async () => {
        const observer = new ViewerCountObserver();

        await expect(observer.initialize()).resolves.toBeUndefined();
        await expect(observer.cleanup()).resolves.toBeUndefined();
    });
});
