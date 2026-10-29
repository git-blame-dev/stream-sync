import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { getDefaultGoalsManager, resetDefaultGoalsManager, type createOBSGoalsManager } from '../../src/obs/goals';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createGoalTracker } from '../../src/utils/goal-tracker';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../helpers/bun-timers';

test('repeated single and all-goal updates join exact real tracker projections', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalSource: 'synthetic-tiktok-goal', tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins', youtubeGoalEnabled: true, youtubeGoalSource: 'synthetic-youtube-goal', youtubeGoalTarget: 100, youtubeGoalCurrency: 'USD' });
    try {
        await h.start();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        expect(goals.getCurrentGoalStatus('twitch')?.formatted).toBe('00000/10000 bits');
        h.socket.writes.length = 0;
        for (let index = 0; index < 10; index++) await goals.updateGoalDisplay('tiktok');
        for (let index = 0; index < 5; index++) await goals.updateAllGoalDisplays();
        const write = (inputName: string, text: string) => ({
            inputName, inputSettings: { font: { face: 'Synthetic font' }, color: 123, text }, overlay: false,
        });
        expect(h.socket.writes).toEqual([
            ...Array.from({ length: 10 }, () => write('synthetic-tiktok-goal', '0000/1000 coins')),
            ...Array.from({ length: 5 }, () => [
                write('synthetic-tiktok-goal', '0000/1000 coins'),
                write('synthetic-youtube-goal', '$0.00/$100.00'),
                write('synthetic-native-goal', '00000/10000 bits'),
            ]).flat(),
        ]);
    } finally {
        await h.dispose();
    }
});

test('greeting waits for both matching external media ends before TTS', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    h.config.obs.ttsNotificationsEnabled = true;
    h.config.displayQueue.rowIntervalMs = 1000;

    h.config.vfx.filePath = '/synthetic-only';
    h.config.cooldowns.cmdCooldown = 0;
    h.config.cooldowns.globalCmdCooldownMs = 0;
    h.config.commands.a = '!a,Synthetic A,,5000';
    h.config.commands.b = '!b,Synthetic B,,5000';
    const restarts: string[] = [];
    const original = h.socket.call.bind(h.socket);
    h.socket.call = async (method, data = {}) => {
        if (method === 'TriggerMediaInputAction') {
            restarts.push(String(data.inputName));
            return {};
        }
        return original(method, data);
    };
    const until = async (condition: () => boolean) => {
        for (let i = 0; i < 100; i++) {
            if (condition()) return;
            await Promise.resolve();
        }
        throw new Error('Synthetic media admission did not arrive');
    };
    const spokenTts: string[] = [];
    const ttsWrites = () => spokenTts;
    let running: Promise<void> | undefined;
    let off = () => {};
    const completions: unknown[] = [];
    try {
        await h.start();
        h.queue.effects.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).endsWith('/v1/speak') && init?.method === 'POST') spokenTts.push((JSON.parse(String(init.body)) as { text: string }).text);
            return new Response(null, { status: 200 });
        };
        useFakeTimers();
        off = h.bus.subscribe('vfx:effect-completed', event => { completions.push(event); });
        h.queue.addItem({ type: 'greeting', platform: 'twitch',
            vfxConfig: { commandKey: 'a', command: '!a', filename: 'a', mediaSource: 'Synthetic A', vfxFilePath: '/synthetic-only', duration: 5000 },
            secondaryVfxConfig: { commandKey: 'b', command: '!b', filename: 'b', mediaSource: 'Synthetic B', vfxFilePath: '/synthetic-only', duration: 5000 },
            data: { username: 'Synthetic viewer', userId: 'synthetic-viewer', ttsMessage: 'Synthetic greeting' } });
        running = h.queue.processQueue();
        await until(() => restarts.length === 1);
        h.queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'Synthetic second', message: 'Synthetic row' } });
        await until(() => h.rows.length === 2);
        h.queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'Synthetic third', message: 'Synthetic later row' } });
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(h.rows).toHaveLength(2);
        advanceTimersByTime(999);
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(h.rows).toMatchObject([
            { type: 'greeting', data: { username: 'Synthetic viewer', ttsMessage: 'Synthetic greeting' } },
            { type: 'chat', data: { username: 'Synthetic second', message: 'Synthetic row' } },
        ]);
        expect(completions).toEqual([]);
        expect(ttsWrites()).toEqual([]);
        advanceTimersByTime(1);
        await until(() => h.rows.length === 3);
        expect(h.rows).toMatchObject([
            { type: 'greeting', data: { username: 'Synthetic viewer', ttsMessage: 'Synthetic greeting' } },
            { type: 'chat', data: { username: 'Synthetic second', message: 'Synthetic row' } },
            { type: 'chat', data: { username: 'Synthetic third', message: 'Synthetic later row' } },
        ]);
        expect(completions).toEqual([]);
        expect(restarts).toEqual(['Synthetic A']);
        expect(ttsWrites()).toEqual([]);
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic unrelated' });
        for (let i = 0; i < 100; i++) await Promise.resolve();
        expect(restarts).toEqual(['Synthetic A']);
        expect(ttsWrites()).toEqual([]);
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic A' });
        await until(() => restarts.length === 2);
        expect(restarts).toEqual(['Synthetic A', 'Synthetic B']);
        expect(ttsWrites()).toEqual([]);
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic B' });
        for (let i = 0; i < 5; i++) { advanceTimersByTime(1000); for (let j = 0; j < 100; j++) await Promise.resolve(); }
        await running;
        expect(completions).toHaveLength(2);
        expect(completions.map(value => (value as { commandKey: string }).commandKey)).toEqual(['a', 'b']);
        const ids = completions.map(value => (value as { correlationId: string }).correlationId);
        expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
        expect(new Set(ids).size).toBe(2);
        expect(ttsWrites()).toEqual(['Synthetic greeting']);
    } finally {
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic A' });
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic B' });
        off();
        try {
            try { if (running) { await h.queue.stop(); await running; } }
            finally { await h.dispose(); }
        } finally { useRealTimers(); }
        const writesAfterRetirement = h.socket.writes.length;
        h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic B' });
        await Promise.resolve();
        expect(h.socket.writes).toHaveLength(writesAfterRetirement);
    }
});

test('100-bit presentation credits the real native goal once, including re-admission', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
        await h.start();
        h.socket.writes.length = 0;
        const gift = { type: 'platform:gift', platform: 'twitch', data: {
            username: 'Synthetic supporter', userId: 'synthetic-supporter', amount: 100, currency: 'bits',
        } };
        h.queue.addItem(gift);
        expect(h.nativeGoal()?.current).toBe(0);
        await h.drain();
        expect(h.nativeGoal()?.current).toBe(100);
        expect(gift.data).toMatchObject({ goalProcessed: true, goalOutcome: 'applied' });
        expect(h.socket.writes).toEqual([{ inputName: 'synthetic-native-goal',
            inputSettings: { font: { face: 'Synthetic font' }, color: 123, text: '00100/10000 bits' }, overlay: false }]);
        h.queue.addItem(gift);
        await h.drain();
        expect(h.nativeGoal()?.current).toBe(100);
        expect(h.socket.writes).toHaveLength(1);
    } finally { await h.dispose(); }
});

for (const outcome of ['timeout', 'restart failure', 'retirement'] as const) {
    test(`sequential VFX ${outcome} follows existing fallback and retirement policy`, async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.logging.chat.enabled = false;
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.vfx.filePath = '/synthetic-only';
        h.config.commands.a = '!a,Synthetic A,,5000';
        let admitted = false;
        const original = h.socket.call.bind(h.socket);
        h.socket.call = async (method, data = {}) => {
            if (method === 'TriggerMediaInputAction') {
                admitted = true;
                if (outcome === 'restart failure') throw new Error('synthetic restart failure');
                return {};
            }
            return original(method, data);
        };
        const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
        const spokenTexts: string[] = [];
        const texts = () => spokenTexts;
        let running: Promise<void> | undefined;
        let fake = false;
        try {
            await h.start();
            h.queue.effects.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input).endsWith('/v1/speak') && init?.method === 'POST') spokenTexts.push((JSON.parse(String(init.body)) as { text: string }).text);
                return new Response(null, { status: 200 });
            };
            useFakeTimers(); fake = true;
            h.queue.addItem({ type: 'platform:follow', platform: 'twitch',
                vfxConfig: { commandKey: 'a', command: '!a', filename: 'a', mediaSource: 'Synthetic A', vfxFilePath: '/synthetic-only' },
                data: { username: 'Synthetic follower', userId: 'synthetic-follower', ttsMessage: 'Synthetic follow' } });
            running = h.queue.processQueue();
            await flush();
            expect(admitted).toBe(true);
            expect(texts()).toEqual([]);
            if (outcome === 'retirement') {
                await h.queue.stop();
                await running;
                h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic A' });
                advanceTimersByTime(11000);
                await flush();
                expect(texts()).toEqual([]);
            } else {
                advanceTimersByTime(9999);
                await flush();
                expect(texts()).toEqual([]);
                advanceTimersByTime(1);
                await flush();
                advanceTimersByTime(50);
                await flush();
                await running;
                expect(texts()).toEqual(['Synthetic follow']);
            }
        } finally {
            h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic A' });
            try {
                try { if (running) { await h.queue.stop(); await running; } }
                finally { await h.dispose(); }
            } finally { if (fake) useRealTimers(); }
        }
    });
}

for (const mode of ['no VFX', 'partial VFX', 'two speech stages', 'gift VFX', 'single follow'] as const) {
    test(`real effects preserve ${mode} staging`, async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.logging.chat.enabled = false;
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.vfx.filePath = '/synthetic-only';
        h.config.commands.a = '!a,Synthetic A,,5000';
        h.config.commands.gifts = '!gift,Synthetic A,,5000';
        const original = h.socket.call.bind(h.socket);
        const restarts: unknown[] = [];
        h.socket.call = async (method, data = {}) => {
            if (method === 'TriggerMediaInputAction') {
                restarts.push(data.inputName);
                queueMicrotask(() => h.socket.emit('MediaInputPlaybackEnded', { inputName: data.inputName }));
                return {};
            }
            return original(method, data);
        };
        let fake = false;
        let off = () => {};
        const commands: unknown[] = [];
        const texts: string[] = [];
        let running: Promise<unknown> | undefined;
        try {
            await h.start();
            h.queue.effects.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input).endsWith('/v1/speak') && init?.method === 'POST') texts.push((JSON.parse(String(init.body)) as { text: string }).text);
                return new Response(null, { status: 200 });
            };
            off = h.bus.subscribe('vfx:command-received', event => { commands.push(event); });
            useFakeTimers(); fake = true;
            const complete = { commandKey: 'a', command: '!a', filename: 'a', mediaSource: 'Synthetic A', vfxFilePath: '/synthetic-only' };
            const giftVfx = { ...complete, commandKey: 'gifts', command: '!gift' };
            const item = { type: mode === 'gift VFX' || mode === 'partial VFX' ? 'platform:gift' : mode === 'two speech stages' ? 'platform:paypiggy' : mode === 'single follow' ? 'platform:follow' : 'greeting', platform: mode === 'gift VFX' || mode === 'partial VFX' ? 'tiktok' : mode === 'two speech stages' ? 'youtube' : 'twitch',
                ...(mode === 'partial VFX' ? { vfxConfig: { commandKey: 'a' } } : mode === 'no VFX' ? {} : { vfxConfig: mode === 'gift VFX' ? giftVfx : complete }),
                data: { username: 'Synthetic viewer', userId: 'synthetic-viewer', giftType: 'synthetic-rose', giftCount: 2, amount: 20, currency: 'coins' } };
            const stages = mode === 'gift VFX' ? [] : mode === 'two speech stages'
                ? [{ type: 'primary' as const, text: 'Synthetic first', delay: 0 }, { type: 'message' as const, text: 'Synthetic second', delay: 0 }]
                : [{ type: 'primary' as const, text: 'Synthetic first', delay: 0 }];
            running = mode === 'gift VFX' ? h.queue.effects.handleGiftEffects(item, stages) : h.queue.effects.handleSequentialEffects(item, stages);
            for (let step = 0; step < 8; step++) {
                for (let turn = 0; turn < 200; turn++) await Promise.resolve();
                advanceTimersByTime(mode === 'gift VFX' && step === 0 ? 2000 : 50);
            }
            await running;
            expect(restarts).toEqual(mode === 'gift VFX' || mode === 'two speech stages' || mode === 'single follow' ? ['Synthetic A'] : []);
            if (mode === 'gift VFX') expect(commands).toMatchObject([{ commandKey: 'gifts', username: 'Synthetic viewer', platform: 'tiktok' }]);
            else if (mode === 'no VFX' || mode === 'partial VFX') expect(commands).toEqual([]);
            expect(texts).toEqual(mode === 'gift VFX' ? [] : mode === 'two speech stages' ? ['Synthetic first', 'Synthetic second'] : ['Synthetic first']);
        } finally {
            h.socket.emit('MediaInputPlaybackEnded', { inputName: 'Synthetic A' });
            off();
            try { try { if (running) { await h.queue.stop(); await running; } } finally { await h.dispose(); } }
            finally { if (fake) useRealTimers(); }
        }
    });
}

test('real goal tracker handles mutation, invalid inputs, disconnection and external write recovery', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalSource: 'synthetic-tiktok-goal', tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins' });
    try {
        await h.start();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        h.socket.writes.length = 0;
        expect(await goals.processDonationGoal('tiktok', 100, 'coins')).toMatchObject({ success: true, newTotal: 100 });
        expect(goals.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 100, formatted: '0100/1000 coins' });
        expect(h.socket.writes).toMatchObject([{ inputName: 'synthetic-tiktok-goal', inputSettings: { text: '0100/1000 coins' } }]);
        expect(await goals.processDonationGoal('tiktok', 0, 'coins')).toMatchObject({ success: false });
        expect(await goals.processPaypiggyGoal('tiktok', 0)).toMatchObject({ success: false });
        expect(await goals.processDonationGoal(null, 100)).toMatchObject({ success: false });
        expect(await goals.processDonationGoal('tiktok', Symbol('synthetic invalid amount') as unknown as number)).toMatchObject({ success: false });
        expect(goals.getCurrentGoalStatus(null as unknown as string)).toBeNull();
        expect(h.socket.writes).toHaveLength(1);
        await h.obs.disconnect();
        expect(await goals.processDonationGoal('tiktok', 200, 'coins')).toMatchObject({ success: true, newTotal: 300 });
        expect(h.socket.writes).toHaveLength(1);
        await h.obs.connect();
        const original = h.socket.call.bind(h.socket);
        let fail = true;
        h.socket.call = async (method, data = {}) => {
            if (method === 'SetInputSettings' && fail) { fail = false; throw new Error('synthetic OBS failure'); }
            return original(method, data);
        };
        await goals.updateGoalDisplay('tiktok');
        expect(h.socket.writes).toHaveLength(1);
        await goals.updateGoalDisplay('tiktok');
        expect(h.socket.writes).toMatchObject([
            { inputName: 'synthetic-tiktok-goal', inputSettings: { text: '0100/1000 coins' } },
            { inputName: 'synthetic-tiktok-goal', inputSettings: { text: '0300/1000 coins' } },
        ]);
    } finally { await h.dispose(); }
});

test('real goal membership, enablement and source policies produce exact output', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalSource: 'synthetic-tiktok-goal', tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins', youtubeGoalEnabled: false });
    try {
        await h.start();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        h.socket.writes.length = 0;
        expect(await goals.processPaypiggyGoal('tiktok', 5)).toMatchObject({ success: true, newTotal: 2100 });
        expect(goals.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 2100, formatted: '2100/1000 coins' });
        expect(goals.getAllCurrentGoalStatuses()).toMatchObject({ tiktok: { current: 2100 }, twitch: { current: 0 } });
        expect(h.socket.writes).toMatchObject([{ inputName: 'synthetic-tiktok-goal', inputSettings: { text: '2100/1000 coins' } }]);
        await goals.updateAllGoalDisplays();
        expect(h.socket.writes.map(write => write.inputName)).toEqual(['synthetic-tiktok-goal', 'synthetic-tiktok-goal', 'synthetic-native-goal']);
        expect(await goals.processDonationGoal('youtube', 1, 'USD')).toMatchObject({ success: false });
        expect(await goals.processPaypiggyGoal('youtube', 1)).toMatchObject({ success: false });
        h.config.goals.tiktokGoalSource = '';
        await goals.updateGoalDisplay('tiktok');
        expect(h.socket.writes).toHaveLength(3);
        await h.obs.disconnect();
        expect(await goals.processPaypiggyGoal('tiktok', 1)).toMatchObject({ success: true, newTotal: 2520 });
        expect(goals.getCurrentGoalStatus('tiktok')).toMatchObject({ current: 2520 });
        expect(h.socket.writes).toHaveLength(3);
    } finally { await h.dispose(); }
});

test('disabled real goal system rejects donation and membership without output', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    h.config.goals.enabled = false;
    try {
        await h.start();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        h.socket.writes.length = 0;
        await goals.initializeGoalDisplay();
        expect(await goals.processDonationGoal('twitch', 100, 'bits')).toMatchObject({ success: false });
        expect(await goals.processPaypiggyGoal('twitch', 1)).toMatchObject({ success: false });
        expect(h.socket.writes).toEqual([]);
    } finally { await h.dispose(); }
});

test('real goal initialization writes connected state, skips disconnected output, and recovers from invalid target', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
        await h.start();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        h.socket.writes.length = 0;
        await goals.initializeGoalDisplay();
        expect(h.socket.writes).toMatchObject([{ inputName: 'synthetic-native-goal', inputSettings: { text: '00000/10000 bits' } }]);
        await h.obs.disconnect();
        await goals.initializeGoalDisplay();
        expect(h.socket.writes).toHaveLength(1);
        await h.obs.connect();
        h.config.goals.twitchGoalTarget = Symbol('synthetic invalid target') as unknown as number;
        await expect(goals.initializeGoalDisplay()).rejects.toThrow();
        h.config.goals.twitchGoalTarget = 10000;
        await goals.initializeGoalDisplay();
        expect(h.socket.writes).toHaveLength(2);
        expect(h.nativeGoal()).toMatchObject({ current: 0, formatted: '00000/10000 bits' });
    } finally { await h.dispose(); }
});


test('default goal manager owns a real tracker and source projection', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
        await h.start();
        resetDefaultGoalsManager();
        const sources = createOBSSourcesManager(h.obs);
        const goals = getDefaultGoalsManager({ obsManager: h.obs, sourcesManager: sources, config: h.config });
        h.socket.writes.length = 0;
        await goals.initializeGoalDisplay();
        expect(goals.getCurrentGoalStatus('twitch')).toMatchObject({ current: 0, formatted: '00000/10000 bits' });
        expect(h.socket.writes).toMatchObject([{ inputName: 'synthetic-native-goal', inputSettings: { text: '00000/10000 bits' } }]);
    } finally { resetDefaultGoalsManager(); await h.dispose(); }
});


test('default goal singleton uses the supplied concrete tracker', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try {
        await h.start();
        resetDefaultGoalsManager();
        const tracker = createGoalTracker({ config: h.config });
        const sources = createOBSSourcesManager(h.obs);
        const goals = getDefaultGoalsManager({ obsManager: h.obs, sourcesManager: sources, config: h.config, goalTracker: tracker });
        await goals.initializeGoalDisplay();
        h.socket.writes.length = 0;
        expect(tracker.addDonationToGoal('twitch', 100, 'bits')).toMatchObject({ success: true, newTotal: 100 });
        expect(goals.getCurrentGoalStatus('twitch')).toMatchObject({ current: 100, formatted: '00100/10000 bits' });
        expect(await goals.processDonationGoal('twitch', 50, 'bits')).toMatchObject({ success: true, newTotal: 150 });
        expect(tracker.getGoalState('twitch')).toMatchObject({ current: 150, formatted: '00150/10000 bits' });
        expect(h.socket.writes).toEqual([{ inputName: 'synthetic-native-goal', inputSettings: {
            font: { face: 'Synthetic font' }, color: 123, text: '00150/10000 bits',
        }, overlay: false }]);
    } finally { resetDefaultGoalsManager(); await h.dispose(); }
});
