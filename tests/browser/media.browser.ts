import { test as base, expect } from './fixture';
import { createMediaHarness, MEDIA_DURATION_MS } from './media-fixture';

type Media = Awaited<ReturnType<typeof createMediaHarness>>;
const test = base.extend<{ media: Media }>({
  media: async ({ backend }, use) => {
    const media = await createMediaHarness(backend.eventBus, backend.mediaRoot);
    try { await use(media); } finally { await media.close(); }
  },
});

for (const kind of ['playable', 'invalid'] as const) {
  test(`native ${kind} media settles the correlated effects waiter before fallback`, async ({ page, backend, media }) => {
    await page.addInitScript(() => {
      const evidence = { loaded: 0, ended: 0, errors: 0, trustedEnd: false,
        video: null as HTMLVideoElement | null };
      Object.assign(window, { syntheticMediaEvidence: evidence });
      for (const name of ['loadeddata', 'ended', 'error']) {
        document.addEventListener(name, event => {
          if (!(event.target instanceof HTMLVideoElement)) return;
          evidence.video = event.target;
          if (name === 'loadeddata') evidence.loaded++;
          if (name === 'ended') { evidence.ended++; evidence.trustedEnd = event.isTrusted; }
          if (name === 'error') evidence.errors++;
        }, true);
      }
    });
    await page.goto(`${backend.url}/dock`);
    await expect.poll(() => backend.guiClients).toBe(1);
    const ackPromise = page.waitForResponse(response => response.url().endsWith('/api/v1/gui/gift-animations/ack') && response.request().method() === 'POST');
    // Keep a failed earlier pixel assertion from leaving an unobserved response promise.
    void ackPromise.catch(() => undefined);
    media.start(kind);
    if (kind === 'playable') {
      // Read decoded pixels from the actual visible renderer before its native end removes it.
      await expect.poll(() => page.locator('canvas.gui-shell__gift-animation').evaluateAll(canvases => {
        const canvas = canvases[0] as HTMLCanvasElement | undefined;
        if (!canvas) return false;
        const pixel = canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        return pixel[0]! > 200 && pixel[1]! < 40 && pixel[2]! < 40 && pixel[3]! > 200;
      }), { timeout: 4000 }).toBe(true);
    }
    const ack = await ackPromise;
    expect(ack.status()).toBe(200);
    expect(await ack.json()).toEqual({ first: true });
    const reason = kind === 'playable' ? 'ended' : 'media-error';
    expect(ack.request().postDataJSON()).toEqual({ playbackId: media.snapshot().playbackId, reason });
    await expect.poll(() => media.snapshot().order).toEqual(['effect', 'settled', 'released']);
    const state = media.snapshot();
    expect(state.playbackId).toMatch(/^[a-f0-9-]{36}$/);
    expect(state.settlements).toEqual([{ playbackId: state.playbackId, reason }]);
    expect(state.duration).toBe(MEDIA_DURATION_MS);
    expect(state.releaseMs).toBeLessThan(MEDIA_DURATION_MS + 1000);
    expect(state.waiterListeners).toBe(0);
    await expect(page.locator('canvas.gui-shell__gift-animation')).toHaveCount(0);
    const native = await page.evaluate(() => {
      const evidence = (window as unknown as { syntheticMediaEvidence: {
        loaded: number; ended: number; errors: number; trustedEnd: boolean; video: HTMLVideoElement;
      } }).syntheticMediaEvidence;
      const video = evidence.video;
      return { loaded: evidence.loaded, ended: evidence.ended, errors: evidence.errors, trustedEnd: evidence.trustedEnd,
        retired: !video.isConnected && video.paused && !video.hasAttribute('src') &&
          video.onended === null && video.onerror === null && video.onloadeddata === null && video.onpause === null };
    });
    if (kind === 'playable') {
      expect(native.loaded).toBeGreaterThan(0);
      expect(native.ended).toBe(1);
      expect(native.trustedEnd).toBe(true);
      expect(native.errors).toBe(0);
    } else {
      expect(native.errors).toBe(1);
      expect(native.ended).toBe(0);
    }
    expect(native.retired).toBe(true);
    await page.close();
    await expect.poll(() => backend.guiClients).toBe(0);
  });
}
