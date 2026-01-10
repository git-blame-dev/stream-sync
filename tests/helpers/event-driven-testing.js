
const EventEmitter = require('events');
const { waitForDelay, scheduleTimeout, resolveDelay } = require('./time-utils');
const testClock = require('./test-clock');

const waitForEvent = (emitter, eventName, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        const timer = scheduleTimeout(() => {
            emitter.removeListener(eventName, eventHandler);
            reject(new Error(`Event '${eventName}' not emitted within ${timeout}ms`));
        }, timeout);
        
        const eventHandler = (data) => {
            clearTimeout(timer);
            resolve(data);
        };
        
        emitter.once(eventName, eventHandler);
    });
};

const waitFor = async (condition, options = {}) => {
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

const waitForMultipleEvents = async (eventSpecs, timeout = 5000) => {
    const promises = eventSpecs.map(spec => 
        waitForEvent(spec.emitter, spec.eventName, timeout)
    );
    
    return Promise.all(promises);
};

class UserExperienceObserver {
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

    recordNotification(notification) {
        this.observations.notifications.push({
            timestamp: testClock.now() - this.startTime,
            content: notification.content,
            type: notification.type,
            visible: true,
            platform: notification.platform
        });
    }

    recordDisplayChange(change) {
        this.observations.displayChanges.push({
            timestamp: testClock.now() - this.startTime,
            source: change.source,
            newValue: change.newValue,
            previousValue: change.previousValue,
            userVisible: change.userVisible || true
        });
    }

    recordAudioEvent(audioEvent) {
        this.observations.audioEvents.push({
            timestamp: testClock.now() - this.startTime,
            type: audioEvent.type,
            content: audioEvent.content,
            audible: true
        });
    }

    recordUserFacingError(error) {
        this.observations.errors.push({
            timestamp: testClock.now() - this.startTime,
            message: error.message,
            severity: error.severity,
            userImpact: error.userImpact,
            recovered: error.recovered || false
        });
    }

    recordStatusChange(status) {
        this.observations.statusChanges.push({
            timestamp: testClock.now() - this.startTime,
            component: status.component,
            newStatus: status.newStatus,
            previousStatus: status.previousStatus,
            userVisible: status.userVisible || true
        });
    }

    getObservations() {
        return {
            ...this.observations,
            totalDuration: testClock.now() - this.startTime,
            summary: this.generateSummary()
        };
    }

    generateSummary() {
        return {
            notificationsSeen: this.observations.notifications.length,
            displayChanges: this.observations.displayChanges.length,
            audioEventsHeard: this.observations.audioEvents.length,
            errorsEncountered: this.observations.errors.length,
            statusChangesObserved: this.observations.statusChanges.length,
            overallExperience: this.observations.errors.length === 0 ? 'positive' : 'degraded'
        };
    }

    userSawNotification(content) {
        return this.observations.notifications.some(n => 
            n.content.includes(content) && n.visible
        );
    }

    userHeardAudio(content) {
        return this.observations.audioEvents.some(a => 
            a.content.includes(content) && a.audible
        );
    }

    userSawStatusChange(component, status) {
        return this.observations.statusChanges.some(s => 
            s.component === component && s.newStatus === status && s.userVisible
        );
    }
}

const observeUserExperience = async (operation) => {
    const observer = new UserExperienceObserver();
    
    // Make observer available globally during test execution
    global.testUserExperienceObserver = observer;
    
    try {
        const result = await operation();
        return {
            result,
            userExperience: observer.getObservations()
        };
    } finally {
        // Clean up global observer
        delete global.testUserExperienceObserver;
    }
};


const expectUserExperience = (experience, expectations) => {
    // Validate visibility expectations
    if (expectations.shouldSeeNotification) {
        expect(experience.summary.notificationsSeen).toBeGreaterThan(0);
        if (expectations.notificationContent) {
            expect(experience.notifications.some(n => 
                n.content.includes(expectations.notificationContent)
            )).toBe(true);
        }
    }

    // Validate audio expectations
    if (expectations.shouldHearAudio) {
        expect(experience.summary.audioEventsHeard).toBeGreaterThan(0);
        if (expectations.audioContent) {
            expect(experience.audioEvents.some(a => 
                a.content.includes(expectations.audioContent)
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
            expect(experience.statusChanges.some(s => 
                s.component === expectations.statusComponent && 
                s.newStatus === expectations.statusValue
            )).toBe(true);
        }
    }
};

const expectFinalSystemState = (state, expectedState) => {
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

const expectNoTechnicalArtifacts = (content) => {
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
    constructor() {
        this.currentTime = testClock.now();
        this.timers = new Map();
        this.intervals = new Map();
        this.nextTimerId = 1;
    }

    advanceTime(milliseconds) {
        this.currentTime += milliseconds;
        
        // Check and fire timers
        for (const [id, timer] of this.timers.entries()) {
            if (timer.fireTime <= this.currentTime) {
                timer.callback();
                this.timers.delete(id);
            }
        }

        // Check and fire intervals
        for (const [id, interval] of this.intervals.entries()) {
            while (interval.nextFire <= this.currentTime) {
                interval.callback();
                interval.nextFire += interval.delay;
            }
        }
    }

    ['setTimeout'](callback, delay) {
        const id = this.nextTimerId++;
        this.timers.set(id, {
            callback,
            fireTime: this.currentTime + delay
        });
        return id;
    }

    ['setInterval'](callback, delay) {
        const id = this.nextTimerId++;
        this.intervals.set(id, {
            callback,
            delay,
            nextFire: this.currentTime + delay
        });
        return id;
    }

    clearTimeout(id) {
        this.timers.delete(id);
    }

    clearInterval(id) {
        this.intervals.delete(id);
    }

    now() {
        return this.currentTime;
    }
}

class NetworkEventSimulator extends EventEmitter {
    constructor() {
        super();
        this.connected = true;
        this.latency = 0;
        this.bandwidth = Infinity;
    }

    disconnect() {
        this.connected = false;
        this.emit('disconnected');
    }

    reconnect() {
        this.connected = true;
        this.emit('connected');
    }

    simulateRecovery() {
        this.latency = 0;
        this.bandwidth = Infinity;
        this.connected = true;
        this.emit('recovered');
    }

    simulateDegradation(latency, bandwidth) {
        this.latency = latency;
        this.bandwidth = bandwidth;
        this.emit('degraded', { latency, bandwidth });
    }

    isOperational() {
        return this.connected && this.latency < 5000;
    }
}

module.exports = {
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
