import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { logger } from '../../src/core/logging';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/core/EventBus';
import * as constants from '../../src/core/constants';
import { ChatNotificationRouter } from '../../src/services/ChatNotificationRouter';
import { CommandCooldownService } from '../../src/services/CommandCooldownService';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { VFXCommandService } from '../../src/services/VFXCommandService';
import { OperatorControlService, OPERATOR_CONTROL_KEYS } from '../../src/services/operator/operator-control-service';
import { NotificationManager } from '../../src/notifications/NotificationManager';
import { DisplayQueue } from '../../src/obs/display-queue';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createConfigFixture } from '../helpers/config-fixture';
import { noOpLogger } from '../helpers/mock-factories';

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).reverse()) {
        try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Chat admission test cleanup failed');
});
async function fixture(maxQueueSize = 100) {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-admission-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const config = createConfigFixture({ general: { envFileReadEnabled: false },
        commands: { wave: '!synthetic-wave,Synthetic Media,5000', other: '!synthetic-other,Synthetic Media,5000', bye: '!synthetic-bye,Synthetic Media,5000' },
        greetings: { command: '!synthetic-wave' }, farewell: { command: '!synthetic-bye' },
        twitch: { messagesEnabled: true, greetingsEnabled: true, commandsEnabled: true, farewellsEnabled: true },
        cooldowns: { cmdCooldownMs: 60000, globalCmdCooldownMs: 60000 }, vfx: { filePath: '/synthetic-only' } });
    config.farewell.timeout = 300;
    const bus = new EventBus();
    const tracking = new UserTrackingService();
    const cooldown = new CommandCooldownService({ config, logger: noOpLogger });
    cleanups.push(() => cooldown.dispose());
    const vfx = new VFXCommandService(config, bus);
    let afterControlRename = () => {};
    const controls = await OperatorControlService.create({ fs: { readFile, mkdir, writeFile, unlink, rename: async (from, to) => { await rename(from, to); afterControlRename(); } }, filePath: join(dir, 'controls.json'), defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map(key => [key, true])) as Record<typeof OPERATOR_CONTROL_KEYS[number], boolean> });
    const goals = createOBSGoalsManager({ isConnected: () => false }, { config, logger, updateTextSource: async () => {} });
    const queue = new DisplayQueue({ call: async () => ({}) }, { ...config, autoProcess: false, maxQueueSize }, constants, bus,
        { operatorControls: controls, goalsManager: goals, sourcesManager: { updateTextSource: async () => {}, clearTextSource: async () => {} } });
    cleanups.push(() => queue.stop());
    const manager = new NotificationManager({ config, logger: noOpLogger, constants, eventBus: bus, displayQueue: queue, vfxCommandService: { getVFXConfig: (key, message) => vfx.getVFXConfig(key, message) } });
    cleanups.push(() => manager.donationSpamDetector?.destroy?.());
    const router = new ChatNotificationRouter({ config, logger: noOpLogger, runtime: {
        config, displayQueue: queue,
        userTrackingService: {
            hasSeenUser: (id) => tracking.hasSeenUser(typeof id === 'string' ? id : null),
            markMessageSeen: (id, context) => tracking.markMessageSeen(typeof id === 'string' ? id : null, context)
        },
        commandCooldownService: {
            checkUserCooldown: (id, perUser, heavy) => cooldown.checkUserCooldown(typeof id === 'string' ? id : null, perUser, heavy),
            updateUserCooldown: id => cooldown.updateUserCooldown(String(id)),
            checkGlobalCooldown: (name, duration) => cooldown.checkGlobalCooldown(name, duration),
            updateGlobalCooldown: name => cooldown.updateGlobalCooldown(name)
        }, vfxCommandService: vfx,
        prepareFarewellNotification: (platform, username, data) => manager.prepareNotification('farewell', platform, { ...data, username })
    } });
    const send = (message: string, userId = 'synthetic-user', platform = 'twitch', username = userId) => router.handleChatMessage(platform, {
        username, userId, message, timestamp: '2026-01-01T00:00:00.000Z'
    });
    const items = (): DisplayQueueItem[] => queue.queue.flatMap(item => Array.isArray(item.children) ? item.children as DisplayQueueItem[] : [item as DisplayQueueItem]);
    return { config, router, send, items, tracking, cooldown, controls, queue, manager, onControlPersist: (callback: () => void) => { afterControlRename = callback; } };
}

describe('chat admission transaction with real queue and policy owners', () => {
    test.each([
        ['!synthetic-wave', ['chat', 'greeting', 'command', 'chat'], 1],
        ['synthetic hello', ['chat', 'greeting', 'chat'], 0],
        ['!synthetic-bye', ['chat', 'farewell', 'chat'], 0],
    ] as const)('rechecks overlapping %s', async (message, expected, count) => {
        const h = await fixture();
        await Promise.all([h.send(message), h.send(message)]);
        expect(h.items().map(item => item.type)).toEqual([...expected]);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(count);
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(message !== '!synthetic-bye');
        expect([...h.cooldown.globalCommandCooldowns.keys()]).toEqual(message === '!synthetic-bye' ? ['farewell:twitch'] : count ? ['!synthetic-wave'] : []);
    });
    test.each([
        [false, true, true, ['chat', 'greeting'], true, 0],
        [true, false, true, ['chat', 'command'], true, 1],
        [false, false, true, ['chat'], false, 0],
        [false, false, false, [], false, 0],
        [true, true, false, ['greeting', 'command'], true, 1],
        [false, true, false, ['greeting'], true, 0],
        [true, false, false, ['command'], true, 1],
        [true, true, true, ['chat', 'greeting', 'command'], true, 1],
    ] as const)('charges only admitted children commands=%s greetings=%s chat=%s', async (commands, greetings, chat, expected, seen, count) => {
        const h = await fixture();
        await h.controls.setEnabled('commandsEnabled', commands);
        await h.controls.setEnabled('greetingsEnabled', greetings);
        await h.controls.setEnabled('messagesEnabled', chat);
        await h.send('!synthetic-wave');
        expect(h.items().map(item => item.type)).toEqual([...expected]);
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(seen);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(count);
        expect(h.cooldown.globalCommandCooldowns.has('!synthetic-wave')).toBe(count === 1);
        h.queue.clearQueue();
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(seen);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(count);
    });
    test('global command race across users preserves each source chat once', async () => {
        const h = await fixture();
        await Promise.all([h.send('!synthetic-wave', 'synthetic-a'), h.send('!synthetic-wave', 'synthetic-b')]);
        expect(h.items().map(item => item.type)).toEqual(['chat', 'greeting', 'command', 'chat']);
        expect(h.cooldown.getCooldownStatus('synthetic-a').commandCount).toBe(1);
        expect(h.cooldown.getCooldownStatus('synthetic-b').commandCount).toBe(0);
        expect(h.tracking.hasSeenUser('synthetic-b')).toBe(false);
    });
    test('command and plain greeting overlap consumes first seen only once', async () => {
        const h = await fixture();
        await Promise.all([h.send('!synthetic-wave'), h.send('synthetic hello')]);
        expect(h.items().filter(item => item.type === 'chat')).toHaveLength(2);
        expect(h.items().filter(item => item.type === 'greeting')).toHaveLength(1);
        expect(h.items().filter(item => item.type === 'command')).toHaveLength(1);
    });
    test.each([false, true])('rechecks nonconsuming state after command preparation begins cooldownLost=%s', async cooldownLost => {
        const h = await fixture();
        const data = { userId: 'synthetic-user', username: 'Synthetic Viewer' };
        const state = h.router.getFirstMessageState(data, 'twitch');
        const chat: DisplayQueueItem = { type: 'chat', platform: 'twitch', data: { message: 'Synthetic chat' } };
        const pending = h.router.processCommand('twitch', data, { command: '!synthetic-wave' }, {
            firstMessageState: state, greetingsEnabled: true, sourceChatItem: chat
        });
        // Actual async greeting preparation is pending; another admission wins.
        h.tracking.markMessageSeen('synthetic-user');
        if (cooldownLost) h.cooldown.updateUserCooldown('synthetic-user');
        await pending;
        expect(h.items().map(item => item.type)).toEqual(cooldownLost ? ['chat'] : ['chat', 'command']);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(1);
        expect(h.cooldown.globalCommandCooldowns.has('!synthetic-wave')).toBe(!cooldownLost);
    });
    test('operator control commits while actual greeting preparation is pending', async () => {
        const h = await fixture();
        let pending: Promise<readonly DisplayQueueItem[]> | undefined;
        h.onControlPersist(() => {
            expect(h.controls.isEnabled('commandsEnabled')).toBe(true);
            const data = { userId: 'synthetic-user', username: 'Synthetic Viewer' };
            pending = h.router.processCommand('twitch', data, { command: '!synthetic-wave' }, {
                firstMessageState: h.router.getFirstMessageState(data, 'twitch'), greetingsEnabled: true,
                sourceChatItem: { type: 'chat', platform: 'twitch', data: { message: 'Synthetic chat' } }
            });
        });
        await h.controls.setEnabled('commandsEnabled', false);
        expect(pending).toBeDefined();
        await pending;
        expect(h.items().map(item => item.type)).toEqual(['chat', 'greeting']);
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(true);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(0);
        expect(h.cooldown.globalCommandCooldowns.size).toBe(0);
    });
    test('linked profile consumes greeting identity across native IDs without sharing command cooldowns', async () => {
        const h = await fixture();
        h.router.runtime.config.profiles = { synthetic: { id: 'synthetic', greetingCommand: '!synthetic-other', identities: ['twitch:synthetic-a', 'tiktok:synthetic-b'] } };
        h.config.tiktok.messagesEnabled = true;
        h.config.tiktok.greetingsEnabled = true;
        await Promise.all([
            h.send('!synthetic-wave', 'synthetic-native-a', 'twitch', 'synthetic-a'),
            h.send('!synthetic-other', 'synthetic-b', 'tiktok', 'Synthetic B')
        ]);
        expect(h.items().map(item => item.type)).toEqual(['chat', 'greeting', 'command', 'chat', 'command']);
        expect(h.tracking.hasSeenUser('viewer-profile:synthetic')).toBe(true);
        expect(h.tracking.hasSeenUser('synthetic-native-a')).toBe(false);
        expect(h.tracking.hasSeenUser('synthetic-b')).toBe(false);
        expect(h.cooldown.getCooldownStatus('synthetic-native-a').commandCount).toBe(1);
        expect(h.cooldown.getCooldownStatus('synthetic-b').commandCount).toBe(1);
    });
    test('queue receipts contain exact admitted child references and no muted child', async () => {
        const h = await fixture();
        await h.controls.setEnabled('commandsEnabled', false);
        const chat: DisplayQueueItem = { type: 'chat', platform: 'twitch', data: { message: 'Synthetic chat' } };
        const command: DisplayQueueItem = { type: 'command', platform: 'twitch', data: {} };
        const greeting: DisplayQueueItem = { type: 'greeting', platform: 'twitch', data: {} };
        const admitted = h.queue.addSequence([chat, greeting, command]);
        expect(admitted).toEqual([chat, greeting]);
        expect(admitted[0]).toBe(chat);
        expect(admitted[1]).toBe(greeting);
        expect(h.queue.addItem(command)).toEqual([]);
    });
    test('muted farewell changes no state and can be retried after re-enable', async () => {
        const h = await fixture();
        await h.controls.setEnabled('farewellsEnabled', false);
        await h.send('!synthetic-bye');
        expect(h.items().map(item => item.type)).toEqual(['chat']);
        expect(h.cooldown.globalCommandCooldowns.size).toBe(0);
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(false);
        await h.controls.setEnabled('farewellsEnabled', true);
        await h.send('!synthetic-bye');
        expect(h.items().map(item => item.type)).toEqual(['chat', 'farewell', 'chat']);
    });
    test.each([false, true])('failed admission leaves state intact stopped=%s', async stopped => {
        const h = await fixture(1);
        if (stopped) await h.queue.stop();
        await h.send('!synthetic-wave');
        expect(h.items().map(item => item.type)).toEqual(stopped ? [] : ['chat']);
        expect(h.tracking.hasSeenUser('synthetic-user')).toBe(false);
        expect(h.cooldown.getCooldownStatus('synthetic-user').commandCount).toBe(0);
        expect(h.cooldown.globalCommandCooldowns.size).toBe(0);
    });
    test('immediate manager reports mute while preparation remains successful', async () => {
        const h = await fixture();
        await h.controls.setEnabled('giftsEnabled', false);
        const data = { isAnonymous: true, giftCount: 5, tier: '1000', timestamp: '2026-01-01T00:00:00.000Z' };
        expect((await h.manager.prepareNotification('farewell', 'twitch', { ...data, username: 'Synthetic Viewer', userId: 'synthetic-user' })).success).toBe(true);
        expect(await h.manager.handleNotification('platform:giftpaypiggy', 'twitch', data)).toMatchObject({ success: false, disabled: true });
        expect(h.items()).toHaveLength(0);
    });
});
