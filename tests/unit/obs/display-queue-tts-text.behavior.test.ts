import { expect, test } from 'bun:test';
import { DisplayQueueEffects } from '../../../src/obs/display-queue-effects';

test('prepare and speak send identical canonical text and selected voice through the real HTTP helper', async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const effects = new DisplayQueueEffects({
        obsManager: { call: async () => ({}) },
        sourcesManager: { clearTextSource: async () => {}, updateTextSource: async () => {} },
        goalsManager: { processDonationGoal: async () => {}, processPaypiggyGoal: async () => {} },
        config: { obs: { neuralTtsEndpoint: 'http://127.0.0.1:8765', neuralTtsVoice: 'attenborough' } },
        delay: async () => {},
        extractUsername: () => 'Synthetic Viewer',
        handleDisplayQueueError: (_message, error) => { throw error; },
        giftAnimationResolver: { resolveFromNotificationData: async () => null },
        fetch: async (input, init) => {
            requests.push({ path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
            return new Response(null, { status: 200 });
        }
    });
    try {
        await effects.prepareTTSText(' Hi\n<b<b>>Synthetic Viewer</b>!\u0000 ');
        await effects.setTTSText('Hi Synthetic   Viewer!');
        expect(requests).toEqual([
            { path: '/health', body: null },
            { path: '/v1/prepare', body: { text: 'Hi Synthetic Viewer!', voice: 'attenborough' } },
            { path: '/v1/speak', body: { text: 'Hi Synthetic Viewer!', voice: 'attenborough' } }
        ]);
    } finally {
        await effects.dispose();
    }
});
