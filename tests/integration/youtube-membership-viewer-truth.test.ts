import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { ViewerCountExtractionService } from '../../src/services/viewer-count-extraction-service';
import { ViewerCountSystem } from '../../src/utils/viewer-count';
import { OBSViewerCountObserver } from '../../src/observers/obs-viewer-count-observer';
import { PlatformEvents } from '../../src/interfaces/PlatformEvents';
import { noOpLogger } from '../helpers/mock-factories';
import { createRecordingLogger } from '../helpers/recording-logger';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../helpers/bun-timers';

const channelId = `UC${'q'.repeat(22)}`;
const a = 'synthetic_A';
const b = 'synthetic_B';
const epoch = 1900000000000;
function fixture(maxStreams = 2, extractionEnabled = true) {
    const logger = createRecordingLogger();
    let now = epoch;
    let discovered = [a, b];
    let discoveryUnavailable = false;
    const failures = new Set<string>();
    const chatFailures = new Set<string>();
    const infoOverrides = new Map<string, Record<string, unknown>>();
    const infoErrors = new Map<string, Error>();
    const chats = new Map<string, EventEmitter>();
    const membershipAtChat = new Map<string, string[]>();
    const counts = new Map([[a, 10], [b, 20]]);
    let heldInfo: ((id: string) => Promise<void>) | undefined;
    const owner = new InnertubeService({ createWithTimeout: async () => ({
        getChannel: async () => {
            if (discoveryUnavailable) throw new Error('synthetic discovery unavailable');
            return { videos: discovered.map(id => ({ id, is_live: true })), getLiveStreams: async () => ({ videos: [] }) };
        },
        search: async () => ({ videos: [] }),
        getInfo: async (id: string) => {
            await heldInfo?.(id);
            if (infoErrors.has(id)) throw infoErrors.get(id)!;
            if (failures.has(id)) throw new Error('synthetic metadata unavailable');
            return {
                basic_info: infoOverrides.get(id) ?? { id, is_live: true, is_live_content: true, view_count: counts.get(id) },
                getLiveChat: () => {
                    membershipAtChat.set(id, platform.getDetectedStreamIds());
                    if (chatFailures.has(id)) throw new Error('synthetic chat unavailable');
                    const chat = Object.assign(new EventEmitter(), {
                        start(this: EventEmitter) { this.emit('start', { header: { view_selector: { sub_menu_items: [
                            { selected: true }, { selected: true }
                        ] } } }); }, stop() {}, applyFilter() {}
                    });
                    chats.set(id, chat);
                    return chat;
                }
            };
        }
    }) }, { logger: noOpLogger });
    const detector = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    const extraction = new ViewerCountExtractionService(owner, { logger: noOpLogger });
    const platform = new YouTubePlatform({ username: channelId, enabled: true, maxStreams,
        fullCheckInterval: 1, streamPollingInterval: 60, dataLoggingEnabled: false,
        envFileReadEnabled: false, envFileWriteEnabled: false }, {
        logger, innertubeService: owner, streamDetectionService: detector,
        ...(extractionEnabled ? { viewerExtractionService: extraction } : {}),
        now: () => now, monotonicNow: () => now - epoch
    });
    const writes: Array<Record<string, unknown>> = [];
    const store = new ViewerCountSystem({ logger: noOpLogger,
        config: { general: { viewerCountPollingIntervalMs: 60000 } },
        platforms: { youtube: platform }, timeProvider: { now: () => now }
    });
    const observer = new OBSViewerCountObserver({ isConnected: () => true,
        call: async (method, payload) => { expect(method).toBe('SetInputSettings'); writes.push(payload); }
    }, noOpLogger, { config: { youtube: { viewerCountEnabled: true, viewerCountSource: 'Synthetic viewers' } },
        getViewerCountSnapshot: name => store.getViewerCountSnapshot(name)
    });
    store.addObserver(observer);
    const statuses: boolean[] = [];
    const detected: string[][] = [];
    platform.on('platform:event', event => {
        if (event.type === PlatformEvents.STREAM_STATUS) statuses.push(event.data.isLive);
        if (event.type === PlatformEvents.STREAM_DETECTED) detected.push(event.data.newStreamIds);
    });
    return { logger, owner, platform, store, observer, writes, counts, chats, membershipAtChat, statuses, detected, failures, chatFailures, infoOverrides, infoErrors,
        setDiscovery(ids: string[]) { discovered = ids; now += 2; },
        failDiscovery() { discoveryUnavailable = true; now += 2; },
        recoverDiscovery() { discoveryUnavailable = false; now += 2; },
        advanceTime(ms: number) { now += ms; },
        holdInfo(callback: (id: string) => Promise<void>) { heldInfo = callback; },
        async close() { await store.cleanup(); await platform.cleanup(); await owner.dispose(); }
    };
}

describe('authoritative membership through real platform, metadata, provider, store and OBS', () => {
    it('logs confirmed offline once and keeps repeated offline checks and one live stream below capacity healthy', async () => {
        const f = fixture();
        try {
            f.setDiscovery([]);
            await f.platform.checkMultiStream();
            const offlineLogs = () => f.logger.entries.filter(entry => entry.level === 'info' && entry.message.includes('offline; monitoring'));
            expect(offlineLogs()).toHaveLength(1);
            await f.platform.checkMultiStream();
            expect(offlineLogs()).toHaveLength(1);
            expect(f.logger.entries.filter(entry => entry.level === 'warn')).toEqual([]);
            f.setDiscovery([a]);
            await f.platform.checkMultiStream();
            expect(f.platform.getViewerMembershipSnapshot().availability).toBe('live');
            expect(f.platform.connectionManager.isConnectionReady(a)).toBe(true);
            const visible = f.logger.entries.filter(entry => entry.level !== 'debug').length;
            await f.platform.checkMultiStream();
            expect(f.logger.entries.filter(entry => entry.level !== 'debug')).toHaveLength(visible);
            expect(f.logger.entries.filter(entry => entry.level === 'warn')).toEqual([]);
        } finally { await f.close(); }
    });

    it('reports unavailable discovery separately from offline, preserves live connections, and reports recovery', async () => {
        const f = fixture();
        try {
            f.failDiscovery();
            await f.platform.checkMultiStream();
            expect(f.platform.getViewerMembershipSnapshot().availability).toBe('unknown');
            expect(f.logger.entries.some(entry => entry.level === 'warn' && entry.message.includes('discovery'))).toBe(true);
            expect(f.logger.entries.some(entry => entry.message.includes('offline; monitoring'))).toBe(false);
            f.recoverDiscovery();
            f.setDiscovery([a]);
            await f.platform.checkMultiStream();
            expect(f.logger.entries.some(entry => entry.level === 'info' && entry.message.includes('discovery recovered'))).toBe(true);
            f.failDiscovery();
            await f.platform.checkMultiStream();
            expect(f.platform.connectionManager.isConnectionReady(a)).toBe(true);
            expect(f.platform.getViewerMembershipSnapshot().availability).toBe('live');
        } finally { await f.close(); }
    });

    it('bounds degraded discovery reminders without changing unknown availability to offline', async () => {
        const f = fixture();
        f.platform.config.fullCheckInterval = 60000;
        const warnings = () => f.logger.entries.filter(entry => entry.level === 'warn' && entry.message.includes('discovery'));
        try {
            f.failDiscovery();
            await f.platform.checkMultiStream();
            expect(warnings()).toHaveLength(1);
            await f.platform.checkMultiStream();
            expect(warnings()).toHaveLength(1);
            f.advanceTime(60000);
            await f.platform.checkMultiStream();
            expect(warnings()).toHaveLength(2);
            expect(f.platform.getViewerMembershipSnapshot().availability).toBe('unknown');
            expect(f.logger.entries.some(entry => entry.message.includes('offline; monitoring'))).toBe(false);
        } finally { await f.close(); }
    });

    it('retains live discovery and visible errors when a discovered stream cannot attach to chat', async () => {
        const f = fixture();
        try {
            f.setDiscovery([a]);
            f.chatFailures.add(a);
            await f.platform.checkMultiStream();
            expect(f.platform.getViewerMembershipSnapshot()).toMatchObject({ availability: 'live', videoIds: [a] });
            expect(f.platform.connectionManager.isConnectionReady(a)).toBe(false);
            expect(f.logger.entries.some(entry => entry.level === 'error')).toBe(true);
        } finally { await f.close(); }
    });
    it('clears complete observation metadata with counts on cleanup and does not replay the unobserved default zero', async () => {
        const f = fixture();
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({
                count: 30, hasCompleteObservation: true, lastCompleteAt: epoch, latestOutcome: 'complete'
            });
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '30' });
            const writes = f.writes.length;
            await f.store.cleanup();
            expect(f.store.getViewerCountSnapshot('youtube')).toEqual({
                count: 0, hasCompleteObservation: false, lastCompleteAt: null, latestOutcome: 'unknown'
            });
            f.store.addObserver(f.observer);
            await f.observer.initialize();
            expect(f.writes).toHaveLength(writes);
        } finally { await f.close(); }
    });

    it('does not repopulate retired observation metadata when an old real metadata poll settles after cleanup', async () => {
        const f = fixture();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        let pending: Promise<void> | undefined;
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCount('youtube')).toBe(30);
            const writes = f.writes.length;
            f.holdInfo(async id => { if (id === a) { entered(); await gate; } });
            pending = f.store.pollPlatform('youtube');
            await started;
            await f.store.cleanup();
            release();
            await pending;
            expect(f.store.getViewerCountSnapshot('youtube')).toEqual({
                count: 0, hasCompleteObservation: false, lastCompleteAt: null, latestOutcome: 'unknown'
            });
            f.store.addObserver(f.observer);
            await f.observer.initialize();
            expect(f.writes).toHaveLength(writes);
        } finally { release?.(); await pending; await f.close(); }
    });

    it('does not overwrite OBS during unknown initialization or an unavailable first poll', async () => {
        const f = fixture();
        try {
            await f.observer.initialize();
            await f.store.pollPlatform('youtube');
            expect(f.writes).toEqual([]);
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ hasCompleteObservation: false, latestOutcome: 'unavailable' });
        } finally { await f.close(); }
    });

    it('does not keep refreshing confirmed empty zero after discovery becomes unavailable', async () => {
        const f = fixture();
        try {
            f.setDiscovery([]);
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            const previous = f.store.getViewerCountSnapshot('youtube');
            const writes = f.writes.length;
            f.failDiscovery();
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            expect(f.platform.getViewerMembershipSnapshot().availability).toBe('unknown');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 0, lastCompleteAt: previous.lastCompleteAt, latestOutcome: 'unavailable' });
            expect(f.writes).toHaveLength(writes);
        } finally { await f.close(); }
    });

    it('requires complete discovery as well as confirmed known ends before declaring global offline', async () => {
        const f = fixture();
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            f.infoOverrides.set(a, { id: a, end_timestamp: new Date(epoch - 1) });
            f.infoOverrides.set(b, { id: b, end_timestamp: new Date(epoch - 1) });
            f.failDiscovery();
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            expect(f.platform.getViewerMembershipSnapshot()).toMatchObject({ videoIds: [], availability: 'unknown' });
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 30, latestOutcome: 'unavailable' });
            expect(f.statuses).toEqual([true]);
        } finally { await f.close(); }
    });

    it('admits both streams before chat succeeds and includes failed chat attachments in the actual OBS total', async () => {
        const f = fixture();
        f.chatFailures.add(b);
        try {
            await f.platform.checkMultiStream();
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            expect(f.platform.getActiveYouTubeVideoIds()).toEqual([a]);
            expect(f.membershipAtChat.get(b)).toEqual([a, b]);
            expect(f.detected).toEqual([[a, b]]);
            await f.store.pollPlatform('youtube');
            expect(f.writes.at(-1)).toEqual({ inputName: 'Synthetic viewers', inputSettings: { text: '30' }, overlay: true });
        } finally { await f.close(); }
    });

    it('publishes complete single, three-stream, large and zero counts through the store and OBS', async () => {
        const f = fixture(3);
        const c = 'synthetic_C';
        try {
            f.setDiscovery([a]);
            f.counts.set(a, 1234);
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 1234, latestOutcome: 'complete' });
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '1.2K' });

            f.setDiscovery([a, b, c]);
            f.counts.set(a, 45000);
            f.counts.set(b, 32000);
            f.counts.set(c, 18000);
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 95000, latestOutcome: 'complete' });
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '95K' });

            f.counts.set(a, 500);
            f.counts.set(b, 0);
            f.counts.set(c, 250);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 750, latestOutcome: 'complete' });
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '750' });
        } finally { await f.close(); }
    });

    it('keeps the last complete output when all metadata requests fail and publishes recovery', async () => {
        const f = fixture();
        try {
            await f.platform.getLiveVideoIds();
            await f.store.pollPlatform('youtube');
            const previous = f.store.getViewerCountSnapshot('youtube');
            const writes = f.writes.length;
            f.failures.add(a);
            f.failures.add(b);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 30, hasCompleteObservation: true,
                lastCompleteAt: previous.lastCompleteAt, latestOutcome: 'unavailable' });
            expect(f.writes).toHaveLength(writes);
            f.failures.clear();
            f.counts.set(a, 40);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 60, latestOutcome: 'complete' });
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '60' });
        } finally { await f.close(); }
    });

    it('deduplicates discovered membership and never publishes an unsafe complete sum', async () => {
        const f = fixture();
        try {
            f.setDiscovery([a, a, b]);
            await f.platform.getLiveVideoIds();
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            f.counts.set(a, Number.MAX_SAFE_INTEGER);
            f.counts.set(b, 1);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ hasCompleteObservation: false, latestOutcome: 'unavailable' });
            expect(f.writes).toEqual([]);
        } finally { await f.close(); }
    });

    it('keeps polling independent of unknown membership and never claims an initial measured zero', async () => {
        const f = fixture();
        try {
            f.store.startPolling();
            for (let i = 0; i < 30; i++) await Promise.resolve();
            expect(f.store.pollingHandles.youtube).toBeDefined();
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ hasCompleteObservation: false, latestOutcome: 'unavailable' });
            expect(f.writes).toEqual([]);
        } finally { await f.close(); }
    });

    it('schedules enabled YouTube independently before platform registration and observes its later unknown state', async () => {
        useFakeTimers();
        const f = fixture();
        const platforms: Record<string, YouTubePlatform> = {};
        const store = new ViewerCountSystem({ logger: noOpLogger, platformProvider: () => platforms,
            config: { general: { viewerCountPollingIntervalMs: 1000 }, youtube: { enabled: true } } });
        try {
            store.startPolling();
            expect(store.pollingHandles.youtube).toBeDefined();
            platforms.youtube = f.platform;
            advanceTimersByTime(1000);
            for (let i = 0; i < 30; i++) await Promise.resolve();
            expect(store.pollingStats.totalPolls).toBeGreaterThan(0);
            expect(store.getViewerCountSnapshot('youtube')).toMatchObject({ hasCompleteObservation: false, latestOutcome: 'unavailable' });
        } finally { await store.cleanup(); await f.close(); useRealTimers(); }
    });

    it('retains stale complete output when both chats and subsequent metadata/discovery are unavailable', async () => {
        const f = fixture();
        f.chatFailures.add(a);
        f.chatFailures.add(b);
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            const previous = f.store.getViewerCountSnapshot('youtube');
            const writes = f.writes.length;
            f.failDiscovery();
            f.failures.add(a);
            f.failures.add(b);
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            expect(f.statuses).toEqual([true]);
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 30, lastCompleteAt: previous.lastCompleteAt,
                hasCompleteObservation: true, latestOutcome: 'unavailable' });
            expect(f.writes).toHaveLength(writes);
            await f.observer.initialize();
            expect(f.writes.at(-1)?.inputSettings).toEqual({ text: '30' });
            expect(f.store.getViewerCountSnapshot('youtube').lastCompleteAt).toBe(previous.lastCompleteAt);
        } finally { await f.close(); }
    });

    it('fences a provider-already-resolved result at the store after membership changes', async () => {
        const f = fixture();
        let secondStore: ViewerCountSystem | undefined;
        try {
            await f.platform.checkMultiStream();
            const adapter = {
                getViewerCountObservation: async () => {
                    const settled = await f.platform.getViewerCountObservation();
                    // Schedule the real domain transition after the provider result,
                    // before handing that same result to the store continuation.
                    f.setDiscovery([a]);
                    f.infoOverrides.set(b, { id: b, is_live: false, end_timestamp: new Date(epoch - 1000) });
                    await f.platform.getLiveVideoIds();
                    return settled;
                },
                getViewerMembershipGeneration: () => f.platform.getViewerMembershipGeneration()
            };
            secondStore = new ViewerCountSystem({ logger: noOpLogger,
                config: { general: { viewerCountPollingIntervalMs: 60000 } }, platforms: { youtube: adapter }, timeProvider: { now: () => epoch + 10 } });
            secondStore.addObserver(f.observer);
            await secondStore.updateViewerCount('youtube', 30);
            const previous = secondStore.getViewerCountSnapshot('youtube');
            const writes = f.writes.length;
            await secondStore.pollPlatform('youtube');
            expect(secondStore.getViewerCountSnapshot('youtube')).toMatchObject({ count: 30, lastCompleteAt: previous.lastCompleteAt,
                latestOutcome: 'unavailable' });
            expect(f.writes).toHaveLength(writes);
        } finally { await secondStore?.cleanup(); await f.close(); }
    });

    it('rejects an observation from a replaced platform identity at the store handoff', async () => {
        const f = fixture();
        let secondStore: ViewerCountSystem | undefined;
        try {
            await f.platform.checkMultiStream();
            const replacement = {
                getViewerCountObservation: () => f.platform.getViewerCountObservation(),
                getViewerMembershipGeneration: () => f.platform.getViewerMembershipGeneration()
            };
            const adapter = {
                getViewerCountObservation: async () => {
                    const settled = await f.platform.getViewerCountObservation();
                    platforms.youtube = replacement;
                    return settled;
                },
                getViewerMembershipGeneration: () => f.platform.getViewerMembershipGeneration()
            };
            const platforms = { youtube: adapter };
            secondStore = new ViewerCountSystem({ logger: noOpLogger,
                config: { general: { viewerCountPollingIntervalMs: 60000 } }, platforms });
            secondStore.addObserver(f.observer);
            await secondStore.pollPlatform('youtube');
            expect(secondStore.getViewerCountSnapshot('youtube').hasCompleteObservation).toBe(false);
            expect(f.writes).toEqual([]);
        } finally { await secondStore?.cleanup(); await f.close(); }
    });

    it('rechecks membership after the commit clock is read, without an intervening await', async () => {
        const f = fixture();
        let secondStore: ViewerCountSystem | undefined;
        let retirement: Promise<void> | undefined;
        let retireOnClock = false;
        try {
            await f.platform.checkMultiStream();
            secondStore = new ViewerCountSystem({ logger: noOpLogger,
                config: { general: { viewerCountPollingIntervalMs: 60000 } }, platforms: { youtube: f.platform },
                timeProvider: { now: () => {
                    if (retireOnClock) { retireOnClock = false; retirement = f.platform.cleanup(); }
                    return epoch;
                } }
            });
            secondStore.addObserver(f.observer);
            retireOnClock = true;
            await secondStore.pollPlatform('youtube');
            expect(secondStore.getViewerCountSnapshot('youtube').hasCompleteObservation).toBe(false);
            expect(f.writes).toEqual([]);
        } finally { await retirement; await secondStore?.cleanup(); await f.close(); }
    });

    it('reports missing extraction capability as unavailable rather than inventing a zero', async () => {
        const f = fixture(2, false);
        try {
            await f.platform.getLiveVideoIds();
            expect(await f.platform.getViewerCountObservation()).toMatchObject({ kind: 'unavailable', reason: 'capability_missing' });
            expect(await f.platform.getViewerCount()).toBeNull();
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ hasCompleteObservation: false, latestOutcome: 'unavailable' });
            expect(f.writes).toEqual([]);
        } finally { await f.close(); }
    });

    it('retains membership without a borrowed confirmation capability', async () => {
        const f = fixture();
        const detector = new YouTubeStreamDetectionService(f.owner, { logger: noOpLogger });
        const platform = new YouTubePlatform({ username: channelId }, { logger: noOpLogger, streamDetectionService: detector });
        try {
            await platform.getLiveVideoIds();
            f.setDiscovery([]);
            await platform.getLiveVideoIds();
            expect(platform.getDetectedStreamIds()).toEqual([a, b]);
        } finally { await platform.cleanup(); await f.close(); }
    });

    for (const event of ['end', 'error'] as const) {
        it(`keeps domain membership after external chat ${event} while metadata remains live`, async () => {
            const f = fixture();
            try {
                await f.platform.checkMultiStream();
                const generation = f.platform.getViewerMembershipGeneration();
                f.chats.get(b)!.emit(event, event === 'error' ? new Error('synthetic chat failure') : undefined);
                await f.platform.requestImmediateYouTubeStreamRefresh();
                expect(f.platform.getViewerMembershipGeneration()).toBe(generation);
                expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
                expect(f.statuses).toEqual([true]);
                await f.store.pollPlatform('youtube');
                expect(f.store.getViewerCount('youtube')).toBe(30);
            } finally { await f.close(); }
        });
    }

    it('does not admit late discovery/confirmation after platform cleanup', async () => {
        const f = fixture();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        try {
            await f.platform.checkMultiStream();
            f.setDiscovery([a]);
            f.holdInfo(async id => { if (id === b) { entered(); await gate; } });
            const pending = f.platform.getLiveVideoIds();
            await started;
            await f.platform.cleanup();
            release();
            await pending;
            expect(f.platform.getViewerMembershipSnapshot()).toMatchObject({ videoIds: [], availability: 'unknown' });
            expect(await f.platform.getViewerCount()).toBeNull();
            expect(f.statuses).toEqual([true]);
        } finally { release?.(); await f.close(); }
    });

    it('does not let an old omitted-stream confirmation remove a newly reaffirmed member', async () => {
        const f = fixture();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        try {
            await f.platform.checkMultiStream();
            f.setDiscovery([a]);
            f.infoOverrides.set(b, { id: b, is_live: false, end_timestamp: new Date(epoch - 1000) });
            f.holdInfo(async id => { if (id === b) { entered(); await gate; } });
            const pending = f.platform.getLiveVideoIds();
            await started;
            f.setDiscovery([a, b]);
            await f.platform.getLiveVideoIds();
            release();
            await pending;
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
        } finally { release?.(); await f.close(); }
    });

    const unknownConfirmations = [
        { label: 'false live flag alone', basic: { id: b, is_live: false } },
        { label: 'non-live content alone', basic: { id: b, is_live_content: false } },
        { label: 'identity mismatch', basic: { id: 'synthetic_other', end_timestamp: new Date(epoch - 1) } },
        { label: 'future end', basic: { id: b, end_timestamp: new Date(epoch + 100000) } },
        { label: 'invalid end', basic: { id: b, end_timestamp: new Date('synthetic-invalid') } },
        { label: 'string end', basic: { id: b, end_timestamp: 'synthetic-not-a-Date' } },
        { label: 'live/end contradiction', basic: { id: b, is_live: true, end_timestamp: new Date(epoch - 1) } },
        { label: 'upcoming/end contradiction', basic: { id: b, is_upcoming: true, end_timestamp: new Date(epoch - 1) } },
        { label: 'invalid start', basic: { id: b, start_timestamp: new Date('synthetic-invalid'), end_timestamp: new Date(epoch - 1) } },
        { label: 'reversed dates', basic: { id: b, start_timestamp: new Date(epoch), end_timestamp: new Date(epoch - 1) } },
        { label: 'malformed live flag', basic: { id: b, is_live: 'false', end_timestamp: new Date(epoch - 1) } }
    ];
    for (const { label, basic } of unknownConfirmations) {
        it(`retains omitted membership on unknown metadata: ${label}`, async () => {
            const f = fixture();
            try {
                await f.platform.checkMultiStream();
                f.setDiscovery([a]);
                f.infoOverrides.set(b, basic);
                await f.platform.getLiveVideoIds();
                expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            } finally { await f.close(); }
        });
    }

    for (const status of ['ERROR', 'HTTP404'] as const) {
        it(`treats an external SDK ${status} failure as unknown, not terminal`, async () => {
            const f = fixture();
            try {
                await f.platform.checkMultiStream();
                f.setDiscovery([a]);
                f.infoErrors.set(b, Object.assign(new Error('Synthetic unavailable SDK response'), status === 'HTTP404' ? { status: 404 } : { info: { status: 'ERROR' } }));
                await f.platform.getLiveVideoIds();
                expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            } finally { await f.close(); }
        });
    }

    it('limits chat only, not domain membership or complete counts', async () => {
        const f = fixture(1);
        try {
            await f.platform.checkMultiStream();
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            expect(f.platform.getActiveYouTubeVideoIds()).toHaveLength(1);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCount('youtube')).toBe(30);
        } finally { await f.close(); }
    });

    it('retains complete count and timestamp through partial extraction and unavailable omission confirmation', async () => {
        const f = fixture();
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            const previous = f.store.getViewerCountSnapshot('youtube');
            const writeCount = f.writes.length;
            f.setDiscovery([a]);
            f.failures.add(b);
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            expect(f.platform.getDetectedStreamIds()).toEqual([a, b]);
            expect(f.store.getViewerCountSnapshot('youtube')).toMatchObject({ count: 30, hasCompleteObservation: true,
                lastCompleteAt: previous.lastCompleteAt, latestOutcome: 'unavailable' });
            expect(f.writes).toHaveLength(writeCount);
        } finally { await f.close(); }
    });

    it('removes only explicitly ended members and publishes confirmed empty zero through the count observation', async () => {
        const f = fixture();
        try {
            await f.platform.checkMultiStream();
            await f.store.pollPlatform('youtube');
            const generation = f.platform.getViewerMembershipGeneration();
            f.setDiscovery([a]);
            f.infoOverrides.set(b, { id: b, is_live: false, end_timestamp: new Date(epoch - 1000) });
            await f.platform.checkMultiStream();
            expect(f.platform.getDetectedStreamIds()).toEqual([a]);
            expect(f.platform.getViewerMembershipGeneration()).toBeGreaterThan(generation);
            await f.store.pollPlatform('youtube');
            expect(f.store.getViewerCount('youtube')).toBe(10);
            f.setDiscovery([]);
            f.infoOverrides.set(a, { id: a, is_live: false, end_timestamp: new Date(epoch - 1000) });
            await f.platform.checkMultiStream();
            const before = f.writes.length;
            await f.store.updateStreamStatus('youtube', false);
            expect(f.writes).toHaveLength(before);
            await f.store.pollPlatform('youtube');
            expect(f.writes.at(-1)).toEqual({ inputName: 'Synthetic viewers', inputSettings: { text: '0' }, overlay: true });
        } finally { await f.close(); }
    });
});
