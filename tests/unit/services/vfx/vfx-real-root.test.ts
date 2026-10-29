import { expect, spyOn, test } from 'bun:test';
import crypto from 'node:crypto';
import testClock from '../../../helpers/test-clock';
import { createMainPresentationFixture } from '../../../helpers/main-presentation-fixture';
import { VFXCommandService } from '../../../../src/services/VFXCommandService';
import type { DisplayQueueItem } from '../../../../src/interfaces/DisplayQueue';
import { sanitizeForDisplay } from '../../../../src/utils/validation';
import { createEventToGuiContractMapper } from '../../../../src/services/gui/event-to-gui-contract-mapper';

function barrier() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

async function fixture(userCooldown = 60, globalCooldown = 60000, messageLimit = 500) {
    const h = await createMainPresentationFixture();
    h.config.general.maxMessageLength = messageLimit;
    h.config.twitch.greetingsEnabled = false;
    h.config.vfx.filePath = '/synthetic-only';
    h.config.general.keywordParsingEnabled = false;
    h.config.cooldowns.cmdCooldown = userCooldown;
    h.config.cooldowns.globalCmdCooldownMs = globalCooldown;
    h.config.commands.a = '!a|!alias,Synthetic A,synthetic keyword,5000';
    h.config.commands.b = '!b,Synthetic B,,5000';
    h.config.greetings!.command = '!a';
    await h.start();
    return h;
}

function realVfx(h: Awaited<ReturnType<typeof fixture>>): VFXCommandService {
    const service = h.runtime.vfxCommandService;
    if (!(service instanceof VFXCommandService)) throw new Error('Expected real root VFX service');
    return service;
}

const context = (id: string, skipCooldown = false) => ({
    username: 'Synthetic Viewer', userId: id, platform: 'twitch',
    skipCooldown, correlationId: `synthetic-${id}`,
});

test('ordinary CSV keys resolve every alias, both keyword policies, reload and runtime completion', async () => {
    const h = await fixture(0, 0);
    const original = h.socket.call.bind(h.socket);
    const restarts: unknown[] = [];
    const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
        if (method === 'TriggerMediaInputAction') {
            restarts.push(data.inputName);
            queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
            return {};
        }
        return original(method, data);
    });
    const random = spyOn(crypto, 'randomInt');
    let unsubscribe = () => {};
    try {
        const vfx = realVfx(h);
        for (const enabled of [false, true]) {
            h.config.general.keywordParsingEnabled = enabled;
            expect(vfx.reloadConfig()).toBe(true);
            for (const index of [0, 1]) {
                random.mockImplementation(() => index);
                expect(await vfx.getVFXConfig('a', null)).toMatchObject({ command: '!a', commandKey: 'a', mediaSource: 'Synthetic A' });
            }
            random.mockImplementation(() => 0);
            expect(await vfx.getVFXConfig('b', null)).toMatchObject({ commandKey: 'b' });
            expect(await vfx.getVFXConfig('greetings', null)).toMatchObject({ commandKey: 'a' });
            expect(await vfx.getVFXConfig('unknown', null)).toBeNull();
            const keyword = await vfx.selectVFXCommand('unmatched synthetic trigger', 'a synthetic keyword appears');
            if (enabled) expect(keyword).toMatchObject({ commandKey: 'a', matchType: 'keyword' });
            else expect(keyword).toBeNull();
        }
        const completed: unknown[] = [];
        const finished = barrier();
        unsubscribe = h.bus.subscribe('vfx:effect-completed', event => { completed.push(event); finished.release(); });
        h.bus.emit('vfx:command-received', { commandKey: 'b', ...context('runtime'), context: { skipCooldown: false } });
        await finished.promise;
        expect(restarts).toEqual(['Synthetic B']);
        expect(completed).toHaveLength(1);
        unsubscribe();
        expect(completed[0]).toMatchObject({ correlationId: 'synthetic-runtime', commandKey: 'b' });
        h.config.commands.b = '!b|!alias,Synthetic Reload,,5000';
        expect(vfx.reloadConfig()).toBe(true);
        random.mockImplementation(() => 1);
        expect(await vfx.getVFXConfig('a', null)).toMatchObject({ command: '!b', commandKey: 'b', mediaSource: 'Synthetic Reload' });
        expect(await vfx.selectVFXCommand('!a', null)).toMatchObject({ command: '!a', commandKey: 'a' });
    } finally { unsubscribe(); random.mockRestore(); wire.mockRestore(); await h.dispose(); }
});

for (const policy of [
    { name: 'both', user: 60, global: 60000, second: '!b', id: 'one', blocked: true },
    { name: 'user only', user: 60, global: 0, second: '!b', id: 'one', blocked: true },
    { name: 'command only', user: 0, global: 60000, second: '!alias', id: 'two', blocked: true },
    { name: 'command only same user disjoint command', user: 0, global: 60000, second: '!b', id: 'one', blocked: false },
    { name: 'zero', user: 0, global: 0, second: '!b', id: 'one', blocked: false },
    { name: 'disjoint', user: 60, global: 60000, second: '!b', id: 'two', blocked: false },
    { name: 'skip true', user: 60, global: 60000, second: '!b', id: 'one', blocked: false, skip: true },
]) {
    test(`inflight ${policy.name} policy through real OBS effects`, async () => {
        const h = await fixture(policy.user, policy.global);
        const entered = barrier();
        const release = barrier();
        const original = h.socket.call.bind(h.socket);
        let triggers = 0;
        const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
            if (method === 'TriggerMediaInputAction') {
                if (++triggers === 1) { entered.release(); await release.promise; }
                queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
                return {};
            }
            return original(method, data);
        });
        let first: ReturnType<VFXCommandService['executeCommand']> | undefined;
        try {
            const vfx = realVfx(h);
            first = vfx.executeCommand('!a', context('one', policy.skip));
            await entered.promise;
            expect(vfx.userLastCommand.size).toBe(0);
            expect(vfx.globalCommandCooldowns.size).toBe(0);
            const second = await vfx.executeCommand(policy.second, context(policy.id, policy.skip));
            expect(second.success).toBe(!policy.blocked);
            if (policy.blocked) expect(second.error).toBe('Command on cooldown');
            release.release();
            expect((await first).success).toBe(true);
            expect(triggers).toBe(policy.blocked ? 1 : 2);
        } finally { release.release(); await first; wire.mockRestore(); await h.dispose(); }
    });
}

test('external restart failure releases claims, retries and publishes only real successes', async () => {
    const h = await fixture();
    const original = h.socket.call.bind(h.socket);
    let fail = true;
    let unsubscribe = () => {};
    const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
        if (method === 'TriggerMediaInputAction') {
            if (fail) throw new Error('Synthetic restart failure');
            queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
            return {};
        }
        return original(method, data);
    });
    try {
        const vfx = realVfx(h);
        const events: unknown[] = [];
        unsubscribe = h.bus.subscribe('vfx:effect-completed', event => { events.push(event); });
        expect((await vfx.executeCommand('!a', context('one'))).success).toBe(false);
        expect(vfx.userLastCommand.size).toBe(0);
        expect(vfx.globalCommandCooldowns.size).toBe(0);
        expect(events).toHaveLength(0);
        fail = false;
        expect((await vfx.executeCommand('!alias', context('one'))).success).toBe(true);
        expect(events).toHaveLength(1);
        expect(vfx.userLastCommand.size).toBe(1);
        expect((await vfx.executeCommand('!b', context('one'))).error).toBe('Command on cooldown');
        unsubscribe();
    } finally { unsubscribe(); wire.mockRestore(); await h.dispose(); }
});

test('display sanitation preserves valid pairs through real router, queue and GUI mapper', async () => {
    for (const [budget, expected] of [[0, ''], [1, 'A'], [2, 'A'], [3, 'A😀'], [4, 'A😀B'], [2.9, 'A'], [-1, ''], [NaN, ''], [Infinity, 'A😀B']] as const) {
        expect(sanitizeForDisplay(' <b>A😀B</b> ', budget)).toBe(expected);
    }
    expect(sanitizeForDisplay('<b></b>')).toBe('');
    expect(sanitizeForDisplay(null)).toBe('');
    expect(sanitizeForDisplay('javascript:  A   B', 20)).toBe('A B');
    expect(sanitizeForDisplay('a'.repeat(499) + '😀B', 500)).toBe('a'.repeat(499));
    const h = await fixture(0, 0, 2);
    try {
        await h.runtime.chatNotificationRouter!.handleChatMessage('twitch', { username: 'Synthetic Viewer', userId: 'synthetic-chat',
            timestamp: '2026-01-01T00:00:00.000Z', message: 'A😀B' });
        const row = h.queue.queue[0]!;
        if (!('data' in row)) throw new Error('Expected an individual chat row');
        expect(row.data.message).toMatchObject({ text: 'A' });
        const mapper = createEventToGuiContractMapper({ config: { gui: { messageCharacterLimit: 2, showMessages: true } }, fallbackAvatarUrl: 'https://example.invalid/synthetic.png' });
        expect((await mapper.mapDisplayRow(row))?.text).toBe('A');
    } finally { await h.dispose(); }
});

for (const mode of ['skip true', 'user policy only', 'zero policies'] as const) {
    test(`real source supersession via ${mode} releases claims and permits retry`, async () => {
        const h = await fixture(mode === 'zero policies' ? 0 : 60, mode === 'skip true' ? 60000 : 0);
        const entered = barrier();
        const release = barrier();
        const original = h.socket.call.bind(h.socket);
        let triggers = 0;
        const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
            if (method === 'TriggerMediaInputAction') {
                if (++triggers === 1) { entered.release(); await release.promise; return {}; }
                queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
                return {};
            }
            return original(method, data);
        });
        let first: ReturnType<VFXCommandService['executeCommand']> | undefined;
        let unsubscribe = () => {};
        try {
            const vfx = realVfx(h);
            const completions: unknown[] = [];
            unsubscribe = h.bus.subscribe('vfx:effect-completed', event => { completions.push(event); });
            first = vfx.executeCommand('!a', context('one'));
            await entered.promise;
            expect((await vfx.executeCommand('!alias', context('automatic', mode === 'skip true'))).success).toBe(true);
            expect(await first).toMatchObject({ success: false, error: expect.stringContaining('superseded') });
            expect(vfx.userLastCommand.has('one')).toBe(false);
            expect(vfx.globalCommandCooldowns.size).toBe(0);
            release.release();
            expect((await vfx.executeCommand('!a', context('one'))).success).toBe(true);
            expect(completions).toHaveLength(2);
            expect(vfx.stats.failedCommands).toBe(1);
            expect(vfx.stats.successfulCommands).toBe(2);
        } finally { release.release(); await first; unsubscribe(); wire.mockRestore(); await h.dispose(); }
    });
}


test('completed VFX durations use one monotonic sample across wall clock corrections', async () => {
    const h = await fixture(0, 0);
    const original = h.socket.call.bind(h.socket);
    const entered = barrier();
    const release = barrier();
    let mono = 100;
    let wall = 1000000;
    const clock = spyOn(performance, 'now').mockImplementation(() => mono);
    const previousWall = testClock.now();
    testClock.set(wall);
    let calls = 0;
    const wire = spyOn(h.socket, 'call').mockImplementation(async (method, data = {}) => {
        if (method === 'TriggerMediaInputAction') {
            if (++calls === 1) { entered.release(); await release.promise; }
            if (calls === 3) { mono += 1.5; throw new Error('Synthetic restart failure'); }
            queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
            return {};
        }
        return original(method, data);
    });
    const durations: number[] = [];
    const unsubscribe = h.bus.subscribe('vfx:effect-completed', event => durations.push((event as { duration: number }).duration));
    let pending: ReturnType<VFXCommandService['executeCommand']> | undefined;
    try {
        const vfx = realVfx(h);
        pending = vfx.executeCommand('!a', context('clock', true));
        await entered.promise;
        wall -= 10000; testClock.set(wall); mono += 2.5; release.release();
        expect((await pending).success).toBe(true);
        expect(durations).toEqual([2.5]);
        expect(vfx.getStatus().stats.avgExecutionTime).toBe(2.5);
        wall += 20000; testClock.set(wall);
        expect((await vfx.executeCommand('!b', context('clock', true))).success).toBe(true);
        expect(durations).toEqual([2.5, 0]);
        expect(vfx.getStatus().stats.avgExecutionTime).toBe(1.25);
        expect(vfx.getStatus().stats.timedCommands).toBe(2);
        expect((await vfx.executeCommand('!unknown', context('clock', true))).success).toBe(false);
        expect(vfx.getStatus().stats.timedCommands).toBe(2);
        expect((await vfx.executeCommand('!a', context('clock', true))).success).toBe(false);
        expect(durations).toEqual([2.5, 0]);
        expect(vfx.getStatus().stats.timedCommands).toBe(3);
        expect(vfx.getStatus().stats.avgExecutionTime).toBe(4 / 3);
    } finally {
        release.release();
        try { await pending; }
        finally {
            unsubscribe();
            try { await h.dispose(); }
            finally { wire.mockRestore(); clock.mockRestore(); testClock.set(previousWall); }
        }
    }
});

test('canonical greeting retains identity and intact copy through queue and GUI', async () => {
    const h = await createMainPresentationFixture();
    h.config.twitch.greetingsEnabled = true;
    try {
        await h.start();
        const username = 'A'.repeat(999) + '😀B';
        await h.runtime.platformEventRouter.routeEvent({ type: 'platform:chat-message', platform: 'twitch', data: {
            username, userId: 'synthetic-template-pair', message: { text: 'synthetic hello' }, timestamp: '2026-01-01T00:00:00.000Z'
        } });
        const items: DisplayQueueItem[] = h.queue.queue.flatMap(entry => 'children' in entry ? entry.children as DisplayQueueItem[] : [entry]);
        const greeting = items.find(item => item.type === 'greeting');
        expect(greeting).toBeDefined();
        expect(greeting!.data.displayMessage).toBe('Welcome, ' + 'A'.repeat(999) + '! 👋');
        expect(greeting!.data.username).toBe(username);
        const mapper = createEventToGuiContractMapper({ config: { gui: { messageCharacterLimit: 0 } }, fallbackAvatarUrl: 'https://example.invalid/synthetic.png' });
        expect((await mapper.mapDisplayRow(greeting!))!.text).toBe('Welcome, ' + 'A'.repeat(999) + '! 👋');
    } finally { await h.dispose(); }
});
