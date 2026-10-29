import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { installTimerTracking } from '../helpers/bun-timers';

for (const chatLimit of [null, 1]) {
  test(`actual main owns and retires its keepalive with chat limit ${chatLimit}`, async () => {
    const trackedTimers = installTimerTracking().activeTimers;
    const fixture = await createMainPresentationFixture({ chatLimit });
    fixture.config.logging.file.enabled = false;
    fixture.config.logging.chat.enabled = false;
    try {
      const result = await fixture.start();
      expect(result).toMatchObject({ success: true, appStarted: true });
      expect(fixture.runtime.isStarted).toBe(true);
      const interval = fixture.runtime.keepAliveInterval;
      if (chatLimit === null) {
        expect(interval).toBeDefined();
        expect(trackedTimers.has(interval!)).toBe(true);
      } else expect(interval).toBeUndefined();
      await fixture.dispose();
      expect(fixture.runtime.isStarted).toBe(false);
      expect(fixture.runtime.keepAliveInterval).toBeUndefined();
      if (interval !== undefined) expect(trackedTimers.has(interval)).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });
}
