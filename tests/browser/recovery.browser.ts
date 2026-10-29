import { test, expect } from './fixture';

test('operator log owners reset overlapping replay and preserve a paused view without old rows', async ({ page, backend }) => {
  await page.goto(`${backend.url}/operator`);
  await expect.poll(() => backend.logClients).toBe(1);
  for (let i = 1; i <= 3; i++) backend.log(`synthetic-old-log-${i}`);
  await expect(page.getByRole('log').locator('.log-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Pause view', exact: true }).click();
  await backend.restart(Array.from({ length: 5 }, (_, i) => `synthetic-new-log-${i + 1}`));
  await expect.poll(() => backend.logClients).toBe(1);
  await expect(page.getByRole('button', { name: 'Resume view', exact: true })).toBeVisible();
  await expect(page.getByRole('log').locator('.log-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume view', exact: true }).click();
  await expect(page.getByRole('log').locator('.log-row')).toHaveCount(5);
  for (let i = 1; i <= 5; i++) await expect(page.getByText(`synthetic-new-log-${i}`, { exact: true })).toBeVisible();
  await expect(page.getByText('synthetic-old-log-1', { exact: true })).toHaveCount(0);
});

test('native EventSource replaces its cursor across two empty-owner reconnects before first live log', async ({ page, backend }) => {
  await page.goto(`${backend.url}/operator`);
  await expect.poll(() => backend.logClients).toBe(1);
  backend.log('synthetic-before-empty-owner');
  await expect(page.getByText('synthetic-before-empty-owner', { exact: true })).toBeVisible();
  await backend.restart();
  await expect.poll(() => backend.logClients).toBe(1);
  await expect(page.getByRole('log').locator('.log-row')).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    const attempts = backend.logCursors.length;
    backend.disconnectLogs();
    await expect.poll(() => backend.logCursors.length).toBe(attempts + 1);
    expect(backend.logCursors.at(-1)).toBe(`${backend.logSession}:0`);
  }
  backend.log('synthetic-first-empty-owner-log');
  await expect(page.getByText('synthetic-first-empty-owner-log', { exact: true })).toBeVisible();
  await expect(page.getByRole('log').locator('.log-row')).toHaveCount(1);
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`missed notification exit recovers and chat survives reconnect (${reducedMotion})`, async ({ page, context, backend }) => {
    await page.emulateMedia({ reducedMotion });
    const dock = await context.newPage();
    await Promise.all([page.goto(`${backend.url}/notifications`), dock.goto(`${backend.url}/dock`)]);
    await expect.poll(() => backend.guiClients).toBe(2);
    backend.row('test-retained-chat', 'chat');
    await expect(dock.getByText('test-retained-chat', { exact: true })).toBeVisible();
    backend.row('test-before-disconnect');
    await expect(page.getByText('test-before-disconnect', { exact: true })).toBeVisible();
    backend.disconnectGui();
    await expect(dock.getByRole('status')).toHaveText('Reconnecting...');
    await expect.poll(() => backend.guiClients).toBe(0);
    backend.exit('test-before-disconnect');
    backend.reconnectGui();
    await expect.poll(() => backend.guiClients).toBe(2);
    await expect(page.getByText('test-before-disconnect', { exact: true })).toHaveCount(0);
    await expect(dock.getByText('test-retained-chat', { exact: true })).toBeVisible();
    backend.row('test-after-recovery');
    await expect(page.getByText('test-after-recovery', { exact: true })).toBeVisible();
    backend.exit('test-after-recovery');
    await expect(page.locator('.gui-row')).toHaveCount(0);
  });
}

test('server restart accepts the new owner and ignores delayed old HTTP snapshots', async ({ page, backend }) => {
  await backend.controls.setEnabled('messagesEnabled', false);
  await backend.controls.setEnabled('commandsEnabled', false);
  await backend.appearance.set('compactRows', false);
  await backend.appearance.set('maxDisplayableBadges', 1);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held: Promise<void>[] = [];
  let captured = 0;
  let delivered = 0;
  for (const path of ['state', 'appearance']) {
    await page.route(`**/api/v1/operator/${path}`, async route => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      const response = await route.fetch();
      captured++;
      const delivery = gate.then(async () => { await route.fulfill({ response }); delivered++; });
      held.push(delivery);
      await delivery;
    });
  }
  try {
    await page.goto(`${backend.url}/operator`);
    await expect.poll(() => captured).toBe(2);
    const messages = page.getByRole('checkbox', { name: /Chat messages/ });
    const compact = page.getByRole('checkbox', { name: /Compact rows/ });
    await expect(messages).not.toBeChecked();
    await expect(compact).not.toBeChecked();
    const previousOwner = backend.controls.sessionId;
    await backend.restart();
    expect(backend.controls.sessionId).not.toBe(previousOwner);
    await backend.controls.setEnabled('messagesEnabled', true);
    await backend.appearance.set('compactRows', true);
    expect(backend.controls.revision).toBe(1);
    await expect(messages).toBeChecked();
    await expect(compact).toBeChecked();
    release();
    await Promise.all(held);
    await expect.poll(() => delivered).toBe(2);
    // Let fetch continuations and the next render consume the delayed replies.
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(messages).toBeChecked();
    await expect(compact).toBeChecked();
    // Controls publish only after persistence. Click, then await the real server
    // result rather than requiring an immediate optimistic checkbox toggle.
    await messages.click();
    await expect.poll(() => backend.controls.controls.messagesEnabled).toBe(false);
    await expect(messages).not.toBeChecked();
    await expect(compact).toBeChecked();
  } finally { release(); await Promise.allSettled(held); }
});

for (const viewport of [{ width: 360, height: 240 }, { width: 1280, height: 720 }]) {
  test(`dock/overlay bounds and notification animation at ${viewport.width}px`, async ({ page, context, backend }) => {
    await page.setViewportSize(viewport);
    const overlay = await context.newPage();
    const notifications = await context.newPage();
    await overlay.setViewportSize(viewport);
    await notifications.setViewportSize(viewport);
    await notifications.emulateMedia({ reducedMotion: 'no-preference' });
    await Promise.all([
      page.goto(`${backend.url}/dock`), overlay.goto(`${backend.url}/overlay`),
      notifications.goto(`${backend.url}/notifications`),
    ]);
    await notifications.evaluate(() => {
      document.documentElement.dataset.testAnimations = '';
      document.addEventListener('animationstart', event => {
        document.documentElement.dataset.testAnimations += ` ${event.animationName}`;
      });
    });
    await expect.poll(() => backend.guiClients).toBe(3);
    for (let i = 0; i < 5; i++) {
      backend.row(`test-layout-${i}`, 'chat', `test-layout-${i} ${'synthetic long chat text '.repeat(12)}`);
    }
    await expect(page.locator('.gui-row')).toHaveCount(3);
    await expect(overlay.locator('.gui-row')).toHaveCount(3);
    await expect(page.getByText('test-layout-0', { exact: false })).toHaveCount(0);
    for (const target of [page, overlay]) {
      const bounds = await target.getByRole('main').evaluate(element => ({
        right: element.getBoundingClientRect().right,
        viewport: window.innerWidth,
        overflowing: document.documentElement.scrollWidth > window.innerWidth,
      }));
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
      expect(bounds.overflowing).toBe(false);
    }
    const lineClamp = await overlay.locator('.gui-row__text').first().evaluate(element => getComputedStyle(element).webkitLineClamp);
    expect(lineClamp).toBe('2');
    backend.row('test-animated-notification');
    await expect(notifications.getByText('test-animated-notification', { exact: true })).toBeVisible();
    await expect(notifications.locator('html')).toHaveAttribute('data-test-animations', /gui-notification-row-enter/);
    backend.exit('test-animated-notification');
    await expect(notifications.locator('.gui-row')).toHaveCount(0);
    await expect(notifications.locator('html')).toHaveAttribute('data-test-animations', /gui-notification-row-exit/);
  });
}
