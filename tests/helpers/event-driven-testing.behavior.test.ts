import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import EventEmitter from 'node:events';

import testClock from './test-clock';
import {
    waitForEvent,
    waitFor,
    waitForMultipleEvents,
    UserExperienceObserver,
    observeUserExperience,
    expectUserExperience,
    expectFinalSystemState,
    expectNoTechnicalArtifacts,
    TimeSimulator,
    NetworkEventSimulator
} from './event-driven-testing';

describe('event-driven-testing behavior', () => {
    beforeEach(() => {
        testClock.reset();
        delete global.testUserExperienceObserver;
    });

    afterEach(() => {
        testClock.useRealTime();
        delete global.testUserExperienceObserver;
    });

    it('waits for single and multiple emitted events', async () => {
        const emitter = new EventEmitter();
        const emitterA = new EventEmitter();
        const emitterB = new EventEmitter();

        const singlePromise = waitForEvent(emitter, 'done', 100);
        const multiplePromise = waitForMultipleEvents([
            { emitter: emitterA, eventName: 'one' },
            { emitter: emitterB, eventName: 'two' }
        ], 100);

        emitter.emit('done', { ok: true });
        emitterA.emit('one', 'first');
        emitterB.emit('two', 'second');

        await expect(singlePromise).resolves.toEqual({ ok: true });
        await expect(multiplePromise).resolves.toEqual(['first', 'second']);
    });

    it('rejects event waits and condition waits on timeout', async () => {
        const emitter = new EventEmitter();

        await expect(waitForEvent(emitter, 'never', 5)).rejects.toThrow('not emitted');
        await expect(waitFor(() => false, { timeout: 20, interval: 5 }))
            .rejects.toThrow('Condition not met');
    });

    it('resolves asynchronous condition waits when condition eventually becomes true', async () => {
        let attempts = 0;

        await expect(waitFor(async () => {
            attempts += 1;
            return attempts >= 3;
        }, { timeout: 100, interval: 10 })).resolves.toBe(true);

        expect(attempts).toBeGreaterThanOrEqual(3);
    });

    it('records and summarizes user-visible experience outcomes', () => {
        const observer = new UserExperienceObserver();

        testClock.advance(25);
        observer.recordNotification({ content: 'test notification', type: 'platform:gift', platform: 'twitch' });
        testClock.advance(25);
        observer.recordDisplayChange({ source: 'obs', newValue: 'visible', previousValue: 'hidden' });
        testClock.advance(25);
        observer.recordAudioEvent({ type: 'tts', content: 'hello world' });
        testClock.advance(25);
        observer.recordUserFacingError({ message: 'recoverable', severity: 'warning', userImpact: 'low', recovered: true });
        observer.recordStatusChange({ component: 'twitch', newStatus: 'connected', previousStatus: 'connecting' });

        const observations = observer.getObservations();
        expect(observations.notifications.length).toBe(1);
        expect(observations.displayChanges.length).toBe(1);
        expect(observations.audioEvents.length).toBe(1);
        expect(observations.errors.length).toBe(1);
        expect(observations.statusChanges.length).toBe(1);
        expect(observations.summary.notificationsSeen).toBe(1);
        expect(observations.summary.overallExperience).toBe('degraded');

        expect(observer.userSawNotification('test notification')).toBe(true);
        expect(observer.userHeardAudio('hello')).toBe(true);
        expect(observer.userSawStatusChange('twitch', 'connected')).toBe(true);
        expect(observer.userSawStatusChange('youtube', 'connected')).toBe(false);
    });

    it('observes user experience with success and failure cleanup', async () => {
        const success = await observeUserExperience(async () => {
            expect(global.testUserExperienceObserver).toBeDefined();
            global.testUserExperienceObserver.recordNotification({
                content: 'observer event',
                type: 'platform:follow',
                platform: 'tiktok'
            });
            return 'done';
        });

        expect(success.result).toBe('done');
        expect(success.userExperience.summary.notificationsSeen).toBe(1);
        expect(global.testUserExperienceObserver).toBeUndefined();

        await expect(observeUserExperience(async () => {
            throw new Error('observer failure');
        })).rejects.toThrow('observer failure');
        expect(global.testUserExperienceObserver).toBeUndefined();
    });

    it('validates high-level user experience and system state contracts', () => {
        const experience = {
            notifications: [{ content: 'hello user' }],
            audioEvents: [{ content: 'audio alert' }],
            statusChanges: [{ component: 'twitch', newStatus: 'connected' }],
            summary: {
                notificationsSeen: 1,
                audioEventsHeard: 1,
                errorsEncountered: 0,
                statusChangesObserved: 1,
                overallExperience: 'positive'
            }
        };

        expect(() => expectUserExperience(experience, {
            shouldSeeNotification: true,
            notificationContent: 'hello',
            shouldHearAudio: true,
            audioContent: 'audio',
            shouldBeErrorFree: true,
            shouldShowStatus: true,
            statusComponent: 'twitch',
            statusValue: 'connected'
        })).not.toThrow();

        const finalState = {
            operationalState: 'ready',
            userVisibleState: { scene: 'main' },
            dataIntegrity: 'intact',
            userExperienceQuality: 'high'
        };

        expect(() => expectFinalSystemState(finalState, {
            operational: 'ready',
            userVisible: { scene: 'main' },
            dataIntact: true,
            userExperienceQuality: 'high'
        })).not.toThrow();
    });

    it('rejects technical artifact leakage in user-facing content', () => {
        expect(() => expectNoTechnicalArtifacts('Hello user')).not.toThrow();
        expect(() => expectNoTechnicalArtifacts('undefined value shown to user')).toThrow();
        expect(() => expectNoTechnicalArtifacts('[object Object] output')).toThrow();
    });

    it('simulates deterministic timer progression and network lifecycle states', () => {
        const timer = new TimeSimulator();
        let timeoutTriggered = false;
        let intervalCount = 0;

        const timeoutId = timer['setTimeout'](() => {
            timeoutTriggered = true;
        }, 20);
        const intervalId = timer['setInterval'](() => {
            intervalCount += 1;
        }, 10);

        timer.advanceTime(15);
        expect(timeoutTriggered).toBe(false);
        expect(intervalCount).toBe(1);

        timer.advanceTime(10);
        expect(timeoutTriggered).toBe(true);
        expect(intervalCount).toBe(2);

        timer.clearTimeout(timeoutId);
        timer.clearInterval(intervalId);
        timer.advanceTime(20);
        expect(intervalCount).toBe(2);

        const network = new NetworkEventSimulator();
        const events = [];
        network.on('disconnected', () => events.push('disconnected'));
        network.on('connected', () => events.push('connected'));
        network.on('degraded', () => events.push('degraded'));
        network.on('recovered', () => events.push('recovered'));

        expect(network.isOperational()).toBe(true);
        network.disconnect();
        expect(network.isOperational()).toBe(false);
        network.reconnect();
        network.simulateDegradation(6000, 10);
        expect(network.isOperational()).toBe(false);
        network.simulateRecovery();
        expect(network.isOperational()).toBe(true);

        expect(events).toEqual(['disconnected', 'connected', 'degraded', 'recovered']);
    });
});
