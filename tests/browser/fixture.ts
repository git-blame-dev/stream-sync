import './runtime';
import { test as base, expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'vite';
import { createGuiTransportService } from '../../src/services/gui/gui-transport-service';
import { buildConfig } from '../../src/core/config-builders';
import { ConfigValidator } from '../../src/utils/config-validator';
import { createOperatorControlService, OPERATOR_CONTROL_KEYS, type OperatorControls } from '../../src/services/operator/operator-control-service';
import { createOperatorAppearanceService } from '../../src/services/operator/operator-appearance-service';
import { createOperatorLogSource } from '../../src/services/operator/operator-log-source';
import { DISPLAY_EVENT_TYPES } from '../../src/interfaces/DisplayEvents';
import { createEventBus } from '../../src/core/EventBus';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function createBackend(assetsRoot: string, root: string) {
  const bus = createEventBus();
  const streams = new Set<ServerResponse>();
  const logStreams = new Set<ServerResponse>();
  const logCursors: string[] = [];
  let logs = createOperatorLogSource();
  let disconnected = false;
  let port = 0;
  let controls = await newControls();
  let appearance = await newAppearance();
  let service = newService();

  function newControls() {
    return createOperatorControlService({
      defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map(key => [key, true])) as OperatorControls,
      filePath: join(root, 'test-controls.json'),
      platformConfig: buildConfig(ConfigValidator.normalize({ tiktok: { followsEnabled: false } })),
    });
  }
  function newAppearance() {
    return createOperatorAppearanceService({
      defaults: { compactRows: true, rowBackgroundsEnabled: false, maxDisplayableBadges: 3 },
      filePath: join(root, 'test-appearance.json'),
    });
  }
  function newService() {
    return createGuiTransportService({
      config: { gui: {
        enableDock: true, enableOverlay: true, enableNotifications: true, enableOperator: true,
        host: '127.0.0.1', port, dockMaxMessages: 3, overlayMaxMessages: 3,
        overlayMaxLinesPerMessage: 2, notificationTransitionMs: 80,
      } },
      assetsRoot, runtimeAssetRoots: [root], logger, eventBus: bus,
      operatorControls: controls, operatorAppearance: appearance,
      operatorLogs: logs,
      createServer: listener => createServer((req, res) => {
        if (req.url === '/api/v1/logs/events') {
          logCursors.push(String(req.headers['last-event-id'] ?? ''));
          logStreams.add(res);
          res.once('close', () => logStreams.delete(res));
        }
        if (req.url === '/gui/events') {
          if (disconnected) { res.writeHead(503).end(); return; }
          streams.add(res);
          res.once('close', () => streams.delete(res));
        }
        listener(req, res);
      }),
    });
  }
  async function start() {
    await service.start();
    const address = service.getAddress();
    if (!address || typeof address === 'string') throw new Error('Test transport did not bind');
    port = address.port;
  }
  try { await start(); }
  catch (error) { await service.stop(); throw error; }
  return {
    eventBus: bus,
    mediaRoot: root,
    get url() { return `http://127.0.0.1:${port}`; },
    get controls() { return controls; },
    get appearance() { return appearance; },
    get guiClients() { return service.getSseClientCount(); },
    get logClients() { return logStreams.size; },
    get logCursors() { return [...logCursors]; },
    get logSession() { return logs.history().sessionId; },
    log(message: string) {
      logs.append({ timestamp: '2026-01-01T00:00:00.000Z', level: 'info', source: 'synthetic-browser', message, data: null });
    },
    disconnectLogs() { for (const stream of logStreams) stream.end(); },
    row(eventId: string, type = 'platform:follow', text = eventId) {
      bus.emit('display:row', {
        eventId, type, platform: 'twitch', timestamp: '2026-01-01T00:00:00.000Z',
        data: { username: 'test-only-viewer', userId: 'test-only-user',
          avatarUrl: '/gui/assets/preview/avatar-fallback.svg', displayMessage: text, message: text },
      });
    },
    exit(eventId: string) {
      bus.emit(DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE, { eventId, phase: 'exit-started', timestamp: 1 });
    },
    disconnectGui() {
      disconnected = true;
      for (const stream of streams) stream.end();
    },
    reconnectGui() { disconnected = false; },
    async restart(logMessages: readonly string[] = []) {
      await service.stop();
      controls = await newControls();
      appearance = await newAppearance();
      logs = createOperatorLogSource();
      for (const message of logMessages) {
        logs.append({ timestamp: '2026-01-01T00:00:00.000Z', level: 'info', source: 'synthetic-browser', message, data: null });
      }
      service = newService();
      await start();
    },
    async close() {
      await service.stop();
      expect(bus.getListenerSummary()).toEqual({});
    },
  };
}

type Backend = Awaited<ReturnType<typeof createBackend>>;

export const test = base.extend<{ backend: Backend }, { assetsRoot: string }>({
  assetsRoot: [async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'stream-sync-browser-build-'));
    try {
      await build({ configFile: resolve(__dirname, '../../gui/vite.config.ts'), logLevel: 'silent',
        build: { outDir: directory, emptyOutDir: true } });
      await use(directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
  backend: async ({ assetsRoot }, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'stream-sync-browser-state-'));
    let backend: Backend | undefined;
    try { backend = await createBackend(assetsRoot, directory); await use(backend); }
    finally {
      try { await backend?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
  },
});
export { expect };
