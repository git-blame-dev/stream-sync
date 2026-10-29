import { EventEmitter } from 'node:events';
import { describe, expect, beforeEach, afterEach, it } from 'bun:test';
import { createMockFn } from '../../helpers/bun-mock-utils';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../../helpers/bun-timers';
import { OBSConnectionManager, getOBSConnectionManager, resetOBSConnectionManager } from '../../../src/obs/connection';

class Socket extends EventEmitter {
  connect = createMockFn(async () => {
    this.emit('Identified');
    return { obsWebSocketVersion: '5', negotiatedRpcVersion: 1 };
  });
  disconnect = createMockFn(async () => { this.emit('ConnectionClosed', { code: 1000, reason: 'synthetic intentional close' }); });
  async call() { return {}; }
}
const config = { address: 'ws://synthetic.invalid', password: 'synthetic-only', enabled: true, connectionTimeoutMs: 5000 };

describe('OBSConnectionManager reconnection behavior', () => {
  let socket: Socket;
  let manager: OBSConnectionManager;
  beforeEach(() => {
    resetOBSConnectionManager();
    useFakeTimers();
    socket = new Socket();
    manager = new OBSConnectionManager({ obs: socket, config });
    manager.reconnectIntervalMs = 10;
  });
  afterEach(async () => {
    try {
      manager.dispose();
      await manager.disconnect();
      expect(socket.eventNames()).toEqual([]);
      expect(getTimerCount()).toBe(0);
    } finally {
      resetOBSConnectionManager();
      useRealTimers();
    }
  });

  it('schedules a reconnect after a failed connect attempt', async () => {
    socket.connect.mockRejectedValueOnce(new Error('synthetic first failure'));
    await expect(manager.connect()).rejects.toThrow('synthetic first failure');
    let entered!: () => void;
    const attempt = new Promise<void>(resolve => { entered = resolve; });
    socket.connect.mockImplementation(async () => {
      socket.emit('Identified');
      entered();
      return { obsWebSocketVersion: '5', negotiatedRpcVersion: 1 };
    });
    advanceTimersByTime(10);
    await attempt;
    // Joining the actual connection owner also waits for its SDK acknowledgement.
    await manager.ensureConnected();
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(manager.isConnected()).toBe(true);
  });

  it('schedules reconnect on ConnectionClosed events', async () => {
    await manager.connect();
    socket.emit('ConnectionClosed', { code: 1006, reason: 'synthetic dropped connection' });
    let entered!: () => void;
    const attempt = new Promise<void>(resolve => { entered = resolve; });
    socket.connect.mockImplementation(async () => {
      socket.emit('Identified'); entered();
      return { obsWebSocketVersion: '5', negotiatedRpcVersion: 1 };
    });
    advanceTimersByTime(10);
    await attempt;
    await manager.ensureConnected();
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it('does not reconnect after intentional disconnect', async () => {
    await manager.connect();
    await manager.disconnect();
    advanceTimersByTime(6000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(getTimerCount()).toBe(0);
  });

  it('retires a held local retry and releases listeners before timer restoration', async () => {
    let release!: (value: { obsWebSocketVersion: string; negotiatedRpcVersion: number }) => void;
    const held = new Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }>(resolve => { release = resolve; });
    let entered!: () => void;
    const attempt = new Promise<void>(resolve => { entered = resolve; });
    socket.connect.mockImplementation(() => { entered(); return held; });
    try {
      manager.scheduleReconnect('synthetic held retry');
      advanceTimersByTime(10);
      await attempt;
      manager.dispose();
      await manager.disconnect();
      release({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 });
      await held;
      socket.emit('Identified');
      advanceTimersByTime(6000);
      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(socket.eventNames()).toEqual([]);
      expect(manager.isConnected()).toBe(false);
      expect(getTimerCount()).toBe(0);
    } finally { release({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 }); }
  });

  it('clears pending reconnect work when singleton manager resets', async () => {
    const singletonSocket = new Socket();
    const singleton = getOBSConnectionManager({ obs: singletonSocket, config });
    try {
      singleton.reconnectIntervalMs = 10;
      singleton.scheduleReconnect('synthetic singleton reset');
      resetOBSConnectionManager();
      await singleton.disconnect();
      advanceTimersByTime(6000);
      expect(singletonSocket.connect).not.toHaveBeenCalled();
      expect(singletonSocket.eventNames()).toEqual([]);
      expect(getTimerCount()).toBe(0);
    } finally { singleton.dispose(); await singleton.disconnect(); }
  });
});
