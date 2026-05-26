import { EventEmitter } from 'node:events';

import { expect } from 'bun:test';

import testClock from './test-clock';
import { resolveDelay, scheduleTimeout, waitForDelay } from './time-utils';

type EventName = string | symbol;
type WaitForOptions = {
    timeout?: number;
    interval?: number;
};
type EventSpec = {
    emitter: EventEmitter;
    eventName: EventName;
};
type UserExperienceRecord = Record<string, unknown>;
type NotificationObservation = {
    timestamp: number;
    content: string;
    type: unknown;
    visible: boolean;
    platform: unknown;
};
type DisplayChangeObservation = {
    timestamp: number;
    source: unknown;
    newValue: unknown;
    previousValue: unknown;
    userVisible: unknown;
};
type AudioEventObservation = {
    timestamp: number;
    type: unknown;
    content: string;
    audible: boolean;
};
type ErrorObservation = {
    timestamp: number;
    message: unknown;
    severity: unknown;
    userImpact: unknown;
    recovered: unknown;
};
type StatusChangeObservation = {
    timestamp: number;
    component: unknown;
    newStatus: unknown;
    previousStatus: unknown;
    userVisible: unknown;
};
type UserExperienceObservations = {
    notifications: NotificationObservation[];
    displayChanges: DisplayChangeObservation[];
    audioEvents: AudioEventObservation[];
    errors: ErrorObservation[];
    statusChanges: StatusChangeObservation[];
    userInteractions: UserExperienceRecord[];
};
type UserExperienceSummary = {
    notificationsSeen: number;
    displayChanges: number;
    audioEventsHeard: number;
    errorsEncountered: number;
    statusChangesObserved: number;
    overallExperience: 'positive' | 'degraded';
};
type UserExperienceSnapshot = UserExperienceObservations & {
    totalDuration: number;
    summary: UserExperienceSummary;
};
type NotificationInput = UserExperienceRecord & {
    content?: unknown;
    type?: unknown;
    platform?: unknown;
};
type DisplayChangeInput = UserExperienceRecord & {
    source?: unknown;
    newValue?: unknown;
    previousValue?: unknown;
    userVisible?: unknown;
};
type AudioEventInput = UserExperienceRecord & {
    type?: unknown;
    content?: unknown;
};
type UserFacingErrorInput = UserExperienceRecord & {
    message?: unknown;
    severity?: unknown;
    userImpact?: unknown;
    recovered?: unknown;
};
type StatusChangeInput = UserExperienceRecord & {
    component?: unknown;
    newStatus?: unknown;
    previousStatus?: unknown;
    userVisible?: unknown;
};
type UserExperienceExpectations = {
    shouldSeeNotification?: boolean;
    notificationContent?: string;
    shouldHearAudio?: boolean;
    audioContent?: string;
    shouldBeErrorFree?: boolean;
    shouldShowStatus?: boolean;
    statusComponent?: unknown;
    statusValue?: unknown;
};
type UserExperienceAssertionInput = {
    notifications?: Array<{ content: string }>;
    audioEvents?: Array<{ content: string }>;
    statusChanges?: Array<{ component?: unknown; newStatus?: unknown }>;
    summary: Pick<UserExperienceSummary, 'notificationsSeen' | 'audioEventsHeard' | 'errorsEncountered' | 'statusChangesObserved'> & {
        overallExperience: string;
    };
};
type FinalSystemState = {
    operationalState?: unknown;
    userVisibleState?: unknown;
    dataIntegrity?: unknown;
    userExperienceQuality?: unknown;
};
type ExpectedSystemState = {
    operational?: unknown;
    userVisible?: unknown;
    dataIntact?: boolean;
    userExperienceQuality?: unknown;
};
type TimerCallback = () => void;
type TimerEntry = {
    callback: TimerCallback;
    fireTime: number;
};
type IntervalEntry = {
    callback: TimerCallback;
    delay: number;
    nextFire: number;
};

declare global {
    var testUserExperienceObserver: UserExperienceObserver | undefined;
}

const getStringContent = (value: unknown): string => typeof value === 'string' ? value : String(value ?? '');

const waitForEvent = (emitter: EventEmitter, eventName: EventName, timeout = 5000): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        const timer = scheduleTimeout(() => {
            emitter.removeListener(eventName, eventHandler);
            reject(new Error(`Event '${String(eventName)}' not emitted within ${timeout}ms`));
        }, timeout);
        
        const eventHandler = (data: unknown) => {
            clearTimeout(timer);
            resolve(data);
        };
        
        emitter.once(eventName, eventHandler);
    });
};

const waitFor = async (condition: () => boolean | Promise<boolean>, options: WaitForOptions = {}) => {
    const { timeout = 5000, interval = 50 } = options;
    const start = testClock.now();
    const effectiveInterval = resolveDelay(interval);
    
    while (testClock.now() - start < timeout) {
        if (await condition()) {
            return true;
        }
        await waitForDelay(effectiveInterval);
        testClock.advance(effectiveInterval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
};

const waitForMultipleEvents = async (eventSpecs: EventSpec[], timeout = 5000): Promise<unknown[]> => {
    const promises = eventSpecs.map(spec => 
        waitForEvent(spec.emitter, spec.eventName, timeout)
    );
    
    return Promise.all(promises);
};

class UserExperienceObserver {
    observations: UserExperienceObservations;
    startTime: number;

    constructor() {
        this.observations = {
            notifications: [],
            displayChanges: [],
            audioEvents: [],
            errors: [],
            statusChanges: [],
            userInteractions: []
        };
        this.startTime = testClock.now();
    }

    recordNotification(notification: NotificationInput): void {
        this.observations.notifications.push({
            timestamp: testClock.now() - this.startTime,
            content: getStringContent(notification.content),
            type: notification.type,
            visible: true,
            platform: notification.platform
        });
    }

    recordDisplayChange(change: DisplayChangeInput): void {
        this.observations.displayChanges.push({
            timestamp: testClock.now() - this.startTime,
            source: change.source,
            newValue: change.newValue,
            previousValue: change.previousValue,
            userVisible: change.userVisible || true
        });
    }

    recordAudioEvent(audioEvent: AudioEventInput): void {
        this.observations.audioEvents.push({
            timestamp: testClock.now() - this.startTime,
            type: audioEvent.type,
            content: getStringContent(audioEvent.content),
            audible: true
        });
    }

    recordUserFacingError(error: UserFacingErrorInput): void {
        this.observations.errors.push({
            timestamp: testClock.now() - this.startTime,
            message: error.message,
            severity: error.severity,
            userImpact: error.userImpact,
            recovered: error.recovered || false
        });
    }

    recordStatusChange(status: StatusChangeInput): void {
        this.observations.statusChanges.push({
            timestamp: testClock.now() - this.startTime,
            component: status.component,
            newStatus: status.newStatus,
            previousStatus: status.previousStatus,
            userVisible: status.userVisible || true
        });
    }

    getObservations(): UserExperienceSnapshot {
        return {
            ...this.observations,
            totalDuration: testClock.now() - this.startTime,
            summary: this.generateSummary()
        };
    }

    generateSummary(): UserExperienceSummary {
        return {
            notificationsSeen: this.observations.notifications.length,
            displayChanges: this.observations.displayChanges.length,
            audioEventsHeard: this.observations.audioEvents.length,
            errorsEncountered: this.observations.errors.length,
            statusChangesObserved: this.observations.statusChanges.length,
            overallExperience: this.observations.errors.length === 0 ? 'positive' : 'degraded'
        };
    }

    userSawNotification(content: string): boolean {
        return this.observations.notifications.some(n => 
            n.content.includes(content) && n.visible
        );
    }

    userHeardAudio(content: string): boolean {
        return this.observations.audioEvents.some(a => 
            a.content.includes(content) && a.audible
        );
    }

    userSawStatusChange(component: unknown, status: unknown): boolean {
        return this.observations.statusChanges.some(s => 
            s.component === component && s.newStatus === status && s.userVisible
        );
    }
}

const observeUserExperience = async <Result>(operation: () => Result | Promise<Result>) => {
    const observer = new UserExperienceObserver();
    
    // Make observer available globally during test execution
    globalThis.testUserExperienceObserver = observer;
    
    try {
        const result = await operation();
        return {
            result,
            userExperience: observer.getObservations()
        };
    } finally {
        // Clean up global observer
        Reflect.deleteProperty(globalThis, 'testUserExperienceObserver');
    }
};


const expectUserExperience = (experience: UserExperienceAssertionInput, expectations: UserExperienceExpectations) => {
    // Validate visibility expectations
    if (expectations.shouldSeeNotification) {
        expect(experience.summary.notificationsSeen).toBeGreaterThan(0);
        const notificationContent = expectations.notificationContent;
        if (notificationContent) {
            expect((experience.notifications ?? []).some(n =>
                n.content.includes(notificationContent)
            )).toBe(true);
        }
    }

    // Validate audio expectations
    if (expectations.shouldHearAudio) {
        expect(experience.summary.audioEventsHeard).toBeGreaterThan(0);
        const audioContent = expectations.audioContent;
        if (audioContent) {
            expect((experience.audioEvents ?? []).some(a =>
                a.content.includes(audioContent)
            )).toBe(true);
        }
    }

    // Validate error expectations
    if (expectations.shouldBeErrorFree) {
        expect(experience.summary.errorsEncountered).toBe(0);
        expect(experience.summary.overallExperience).toBe('positive');
    }

    // Validate status expectations
    if (expectations.shouldShowStatus) {
        expect(experience.summary.statusChangesObserved).toBeGreaterThan(0);
        if (expectations.statusComponent && expectations.statusValue) {
            expect((experience.statusChanges ?? []).some(s =>
                s.component === expectations.statusComponent && 
                s.newStatus === expectations.statusValue
            )).toBe(true);
        }
    }
};

const expectFinalSystemState = (state: FinalSystemState, expectedState: ExpectedSystemState) => {
    // Operational state (affects user experience)
    if (expectedState.operational !== undefined) {
        expect(state.operationalState).toBe(expectedState.operational);
    }

    // User-visible state
    if (expectedState.userVisible) {
        expect(state.userVisibleState).toEqual(expectedState.userVisible);
    }

    // Data integrity (affects user trust)
    if (expectedState.dataIntact !== undefined) {
        expect(state.dataIntegrity).toBe(expectedState.dataIntact ? 'intact' : 'compromised');
    }

    // User experience quality
    if (expectedState.userExperienceQuality) {
        expect(state.userExperienceQuality).toBe(expectedState.userExperienceQuality);
    }
};

const expectNoTechnicalArtifacts = (content: string) => {
    // Check for technical artifacts that users shouldn't see
    const technicalPatterns = [
        /undefined/,
        /null/,
        /NaN/,
        /\[object Object\]/,
        /function\s*\(/,
        /console\./,
        /logger\./,
        /debug/i,
        /test/i,
        /mock/i
    ];

    technicalPatterns.forEach(pattern => {
        expect(content).not.toMatch(pattern);
    });

    // Ensure content is user-friendly
    expect(typeof content).toBe('string');
    expect(content.trim().length).toBeGreaterThan(0);
};


class TimeSimulator {
    currentTime: number;
    timers: Map<number, TimerEntry>;
    intervals: Map<number, IntervalEntry>;
    nextTimerId: number;

    constructor() {
        this.currentTime = testClock.now();
        this.timers = new Map();
        this.intervals = new Map();
        this.nextTimerId = 1;
    }

    advanceTime(milliseconds: number): void {
        this.currentTime += milliseconds;
        
        // Check and fire timers
        for (const [id, timer] of this.timers.entries()) {
            if (timer.fireTime <= this.currentTime) {
                timer.callback();
                this.timers.delete(id);
            }
        }

        // Check and fire intervals
        for (const [_id, interval] of this.intervals.entries()) {
            while (interval.nextFire <= this.currentTime) {
                interval.callback();
                interval.nextFire += interval.delay;
            }
        }
    }

    ['setTimeout'](callback: TimerCallback, delay: number): number {
        const id = this.nextTimerId++;
        this.timers.set(id, {
            callback,
            fireTime: this.currentTime + delay
        });
        return id;
    }

    ['setInterval'](callback: TimerCallback, delay: number): number {
        const id = this.nextTimerId++;
        this.intervals.set(id, {
            callback,
            delay,
            nextFire: this.currentTime + delay
        });
        return id;
    }

    clearTimeout(id: number): void {
        this.timers.delete(id);
    }

    clearInterval(id: number): void {
        this.intervals.delete(id);
    }

    now(): number {
        return this.currentTime;
    }
}

class NetworkEventSimulator extends EventEmitter {
    connected: boolean;
    latency: number;
    bandwidth: number;

    constructor() {
        super();
        this.connected = true;
        this.latency = 0;
        this.bandwidth = Infinity;
    }

    disconnect(): void {
        this.connected = false;
        this.emit('disconnected');
    }

    reconnect(): void {
        this.connected = true;
        this.emit('connected');
    }

    simulateRecovery(): void {
        this.latency = 0;
        this.bandwidth = Infinity;
        this.connected = true;
        this.emit('recovered');
    }

    simulateDegradation(latency: number, bandwidth: number): void {
        this.latency = latency;
        this.bandwidth = bandwidth;
        this.emit('degraded', { latency, bandwidth });
    }

    isOperational(): boolean {
        return this.connected && this.latency < 5000;
    }
}

export {
    // Event-driven utilities
    waitForEvent,
    waitFor,
    waitForMultipleEvents,
    
    // User experience observation
    UserExperienceObserver,
    observeUserExperience,
    
    // Pure outcome validation
    expectUserExperience,
    expectFinalSystemState,
    expectNoTechnicalArtifacts,
    
    // Deterministic time control
    TimeSimulator,
    NetworkEventSimulator
};
