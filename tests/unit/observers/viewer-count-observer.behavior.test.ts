import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

import '../../../src/observers/viewer-count-observer.ts';

const nodeRequire = createRequire(import.meta.url);

type ViewerCountObserverInstance = {
    onViewerCountUpdate: (update: Record<string, unknown>) => Promise<void>;
    onStreamStatusChange: (statusUpdate: Record<string, unknown>) => Promise<void>;
    getObserverId: () => string;
    initialize: () => Promise<void>;
    cleanup: () => Promise<void>;
};

const { ViewerCountObserver } = nodeRequire('../../../src/observers/viewer-count-observer') as {
    ViewerCountObserver: new () => ViewerCountObserverInstance;
};

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
