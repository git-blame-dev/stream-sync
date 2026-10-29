import { test, expect } from 'bun:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { GuiShell } from '../../../gui/src/shared/components/GuiShell';

test('dock pin frames retire on replacement, mode change and unmount while preserving pin policy', async () => {
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  const pending = new Set<number>();
  let next = 0;
  let renderer: Renderer.ReactTestRenderer | undefined;
  let scroll: (() => void) | undefined;
  globalThis.requestAnimationFrame = () => { const id = ++next; pending.add(id); return id; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  const element = { scrollTop: 0, scrollHeight: 200, clientHeight: 100,
    addEventListener(_name: string, listener: () => void) { scroll = listener; },
    removeEventListener() { scroll = undefined; } };
  const shell = (mode: 'dock' | 'tiktok-animations' = 'dock') => React.createElement(GuiShell, {
    mode, rows: [], overlayMaxLinesPerMessage: 3,
  });
  try {
    await act(async () => { renderer = Renderer.create(shell(), { createNodeMock: () => element }); });
    expect(element.scrollTop).toBe(200);
    expect([...pending]).toEqual([1]);
    await act(async () => renderer!.update(shell()));
    expect([...pending]).toEqual([2]);
    element.scrollTop = 0;
    scroll!();
    await act(async () => renderer!.update(shell()));
    expect(element.scrollTop).toBe(0);
    expect(pending.size).toBe(0);
    element.scrollTop = 100;
    scroll!();
    await act(async () => renderer!.update(shell()));
    expect(element.scrollTop).toBe(200);
    expect(pending.size).toBe(1);
    await act(async () => renderer!.update(shell('tiktok-animations')));
    expect(pending.size).toBe(0);
    await act(async () => renderer!.update(shell()));
    expect(pending.size).toBe(1);
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(pending.size).toBe(0);
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    if (oldRaf === undefined) Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    else globalThis.requestAnimationFrame = oldRaf;
    if (oldCancel === undefined) Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    else globalThis.cancelAnimationFrame = oldCancel;
  }
});
