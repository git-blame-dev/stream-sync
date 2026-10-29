import { describe, expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createEventBus } from '../../../src/core/EventBus';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { createOBSEventService } from '../../../src/obs/obs-event-service';
import { noOpLogger } from '../../helpers/mock-factories';

type Request = { method: string; data: Record<string, unknown> };
const settings = { text: 'synthetic old', font: { face: 'synthetic font' } };
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 200; turn++) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('Synthetic OBS event did not settle');
}
class SyntheticSDK extends EventEmitter {
  requests: Request[] = [];
  connectCount = 0;
  failConnect = false;
  failMethod = '';
  connectHold: ReturnType<typeof Promise.withResolvers<void>> | null = null;
  async connect() {
    this.connectCount++;
    await this.connectHold?.promise;
    if (this.failConnect) throw new Error('synthetic connection failure');
    this.emit('Identified');
    return { obsWebSocketVersion: 'synthetic' };
  }
  async disconnect() { this.emit('ConnectionClosed'); }
  async call(method: string, data: Record<string, unknown> = {}) {
    this.requests.push({ method, data });
    if (this.failMethod === method) { this.failMethod = ''; throw new Error('synthetic OBS failure'); }
    if (method === 'GetVersion') return { obsVersion: 'synthetic' };
    if (method === 'GetInputSettings') return { inputSettings: settings };
    if (method === 'GetSceneItemId') return { sceneItemId: 7 };
    if (method === 'SetInputSettings' || method === 'SetSceneItemEnabled' || method === 'SetCurrentProgramScene') return {};
    throw new Error(`Unexpected synthetic request: ${method}`);
  }
}
function setup() {
  const sdk = new SyntheticSDK();
  const connection = new OBSConnectionManager({ obs: sdk, config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic', connectionTimeoutMs: 5000 } });
  const sources = createOBSSourcesManager(connection, { logger: noOpLogger });
  const bus = createEventBus();
  const service = createOBSEventService({
    eventBus: { subscribe: (name, handler) => bus.subscribe(name, value => handler(value as Record<string, unknown>)), emit: (name, value) => { bus.emit(name, value); } },
    obsConnection: { connect: async () => { await connection.connect(); }, disconnect: () => connection.disconnect(),
      call: (method, data) => connection.call(method, data), isConnected: () => connection.isConnected(), isReady: () => connection.isReady(),
      addEventListener: (name, handler) => connection.addEventListener(name, handler), removeEventListener: (name, handler) => connection.removeEventListener(name, handler) },
    obsSources: sources, logger: noOpLogger,
  });
  const emit = async (name: string, payload: Record<string, unknown>) => {
    const previous = bus.getEventStats()[name]?.success ?? 0;
    expect(bus.emit(name, payload)).toBe(true);
    await until(() => (bus.getEventStats()[name]?.success ?? 0) === previous + 1);
  };
  const dispose = async () => {
    sdk.connectHold?.resolve();
    service.destroy();
    connection.dispose();
    await connection.disconnect();
    expect(bus.getListenerSummary()).toEqual({});
    expect(sdk.eventNames()).toEqual([]);
    bus.reset();
  };
  return { sdk, connection, bus, service, emit, dispose };
}

describe('OBS events through real connection and sources', () => {
  test('valid commands produce exact external writes; invalid commands produce none', async () => {
    const h = setup();
    try {
      await h.service.connect();
      h.sdk.requests.length = 0;
      await h.emit('obs:update-text', { sourceName: null, text: 'synthetic' });
      await h.emit('obs:clear-text', { sourceName: '' });
      await h.emit('obs:set-visibility', { sceneName: 'synthetic scene', sourceName: 'synthetic source', visible: 'true' });
      await h.emit('obs:switch-scene', { sceneName: '' });
      expect(h.sdk.requests).toEqual([]);
      await h.emit('obs:update-text', { sourceName: 'synthetic source', text: 'synthetic text' });
      await h.emit('obs:clear-text', { sourceName: 'synthetic source' });
      await h.emit('obs:set-visibility', { sceneName: 'synthetic scene', sourceName: 'synthetic source', visible: true });
      await h.emit('obs:switch-scene', { sceneName: 'synthetic scene' });
      expect(h.sdk.requests).toEqual([
        { method: 'GetVersion', data: {} },
        { method: 'GetInputSettings', data: { inputName: 'synthetic source' } },
        { method: 'SetInputSettings', data: { inputName: 'synthetic source', inputSettings: { ...settings, text: 'synthetic text' }, overlay: false } },
        { method: 'GetInputSettings', data: { inputName: 'synthetic source' } },
        { method: 'SetInputSettings', data: { inputName: 'synthetic source', inputSettings: { ...settings, text: '' }, overlay: false } },
        { method: 'GetSceneItemId', data: { sceneName: 'synthetic scene', sourceName: 'synthetic source' } },
        { method: 'SetSceneItemEnabled', data: { sceneName: 'synthetic scene', sceneItemId: 7, sceneItemEnabled: true } },
        { method: 'SetCurrentProgramScene', data: { sceneName: 'synthetic scene' } },
      ]);
    } finally { await h.dispose(); }
  });
  test('external failures settle and subsequent text and scene writes recover', async () => {
    const h = setup();
    try {
      await h.service.connect();
      h.sdk.requests.length = 0;
      h.sdk.failMethod = 'SetInputSettings';
      await h.emit('obs:update-text', { sourceName: 'synthetic source', text: 'synthetic rejected' });
      await h.emit('obs:update-text', { sourceName: 'synthetic source', text: 'synthetic recovered' });
      h.sdk.failMethod = 'SetCurrentProgramScene';
      await h.emit('obs:switch-scene', { sceneName: 'synthetic rejected' });
      await h.emit('obs:switch-scene', { sceneName: 'synthetic recovered' });
      expect(h.sdk.requests.filter(request => request.method === 'SetInputSettings')).toEqual([
        { method: 'SetInputSettings', data: { inputName: 'synthetic source', inputSettings: { ...settings, text: 'synthetic rejected' }, overlay: false } },
        { method: 'SetInputSettings', data: { inputName: 'synthetic source', inputSettings: { ...settings, text: 'synthetic recovered' }, overlay: false } },
      ]);
      expect(h.sdk.requests.filter(request => request.method === 'SetCurrentProgramScene').map(request => request.data.sceneName)).toEqual(['synthetic rejected', 'synthetic recovered']);
    } finally { await h.dispose(); }
  });
  test('concurrent service connects share an actual held SDK attempt and retirement removes listeners', async () => {
    const h = setup();
    h.sdk.connectHold = Promise.withResolvers<void>();
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    try {
      first = h.service.connect();
      second = h.service.connect();
      expect(h.sdk.connectCount).toBe(1);
      expect(h.service.getConnectionState().connected).toBe(false);
      h.sdk.connectHold.resolve();
      await Promise.all([first, second]);
      expect(h.service.getConnectionState()).toEqual({ connected: true, ready: true, lastError: null });
      expect(await h.service.getHealthStatus()).toEqual({ healthy: true, connected: true, responsive: true, lastError: undefined });
      await h.service.disconnect();
      expect(h.service.getConnectionState()).toMatchObject({ connected: false, ready: false });
      h.service.destroy();
      h.service.destroy();
      expect(h.bus.getListenerSummary()).toEqual({});
      expect(h.bus.emit('obs:update-text', { sourceName: 'synthetic source', text: 'synthetic late' })).toBe(false);
    } finally { h.sdk.connectHold.resolve(); await Promise.allSettled([first, second]); await h.dispose(); }
  });
  test('failed SDK connection is reported and recovers on a later attempt', async () => {
    const h = setup();
    try {
      h.sdk.failConnect = true;
      await expect(h.service.connect()).rejects.toThrow('synthetic connection failure');
      expect(h.service.getConnectionState()).toMatchObject({ connected: false, ready: false, lastError: expect.any(Error) });
      await h.connection.disconnect();
      h.sdk.failConnect = false;
      await h.service.connect();
      expect(h.service.getConnectionState()).toEqual({ connected: true, ready: true, lastError: null });
      expect(h.sdk.connectCount).toBe(2);
    } finally { await h.dispose(); }
  });
  test('actual close emits connection loss, and an unrelated bus signal does not fabricate disconnection', async () => {
    const h = setup();
    const events: unknown[] = [];
    const off = h.bus.subscribe('obs:connection-lost', value => { events.push(value); });
    try {
      await h.service.connect();
      h.bus.emit('obs:connection-lost', { reason: 'synthetic bus signal' });
      expect(h.service.getConnectionState().connected).toBe(true);
      h.sdk.emit('ConnectionClosed', { code: 1006, reason: 'synthetic socket close' });
      expect(h.service.getConnectionState()).toMatchObject({ connected: false, ready: false });
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ code: 1006, reason: 'synthetic socket close' });
    } finally { off(); await h.dispose(); }
  });

  test('destroy retires bus listeners even when external socket listener removal throws', async () => {
    const h = setup();
    const original = h.sdk.off.bind(h.sdk);
    let failed = false;
    const off = spyOn(h.sdk, 'off').mockImplementation((event, handler) => {
      const result = original(event, handler);
      if (event === 'ConnectionClosed' && !failed) { failed = true; throw new Error('synthetic socket off failure'); }
      return result;
    });
    try {
      await h.service.connect();
      h.service.destroy();
      expect(failed).toBe(true);
      expect(h.bus.getListenerSummary()).toEqual({});
      expect(h.service.connectionEventHandlers).toEqual([]);
      expect(h.service.unsubscribeFns).toEqual([]);
      expect(() => h.service.destroy()).not.toThrow();
    } finally { off.mockRestore(); await h.dispose(); }
  });

});
