const testClock = require('./test-clock');
const { UserExperienceObserver } = require('./event-driven-testing');

describe('event-driven-testing', () => {
    beforeEach(() => {
        testClock.reset();
    });

    test('UserExperienceObserver timestamps use the deterministic test clock', () => {
        testClock.set(1000);
        const observer = new UserExperienceObserver();

        testClock.advance(250);
        observer.recordNotification({
            content: 'test notification',
            type: 'platform:gift',
            platform: 'twitch'
        });

        const observations = observer.getObservations();
        expect(observations.notifications[0].timestamp).toBe(250);
        expect(observations.totalDuration).toBe(250);
    });
});
