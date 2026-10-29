import { describe, expect, spyOn, test } from 'bun:test';
import crypto from 'node:crypto';
import { createMainPresentationFixture } from '../../../helpers/main-presentation-fixture';
import { VFXCommandService } from '../../../../src/services/VFXCommandService';

describe('VFXCommandService random variant selection through real root owners', () => {
    for (const section of ['gifts', 'farewell'] as const) {
        test(`selects each ${section} trigger variant without selecting CSV keywords`, async () => {
            const h = await createMainPresentationFixture();
            h.config.vfx.filePath = '/synthetic-only';
            h.config.commands.one = '!one,Synthetic One,,5000';
            h.config.commands.two = '!two,Synthetic Two,,5000';
            h.config.commands.three = '!three,Synthetic Three,,5000';
            h.config[section].command = '!one|!two|!three, goodbye|synthetic keyword';
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
            try {
                await h.start();
                const service = h.runtime.vfxCommandService;
                if (!(service instanceof VFXCommandService)) throw new Error('Expected real root VFX service');
                for (const [index, filename] of ['one', 'two', 'three'].entries()) {
                    random.mockImplementation(() => index);
                    const result = await service.executeCommandForKey(section, {
                        username: 'Synthetic Viewer', platform: 'twitch', skipCooldown: true, correlationId: `synthetic-${section}-${index}`,
                    });
                    expect(result).toMatchObject({ success: true, vfxConfig: { filename, commandKey: filename } });
                }
                expect(restarts).toEqual(['Synthetic One', 'Synthetic Two', 'Synthetic Three']);
            } finally { random.mockRestore(); wire.mockRestore(); await h.dispose(); }
        });
    }

    test('returns friendly failure for an unconfigured section without OBS writes', async () => {
        const h = await createMainPresentationFixture();
        try {
            await h.start();
            const baseline = h.socket.writes.length;
            const service = h.runtime.vfxCommandService;
            if (!(service instanceof VFXCommandService)) throw new Error('Expected real root VFX service');
            expect(await service.executeCommandForKey('gifts', {
                username: 'Synthetic Viewer', platform: 'twitch', skipCooldown: true, correlationId: 'synthetic-missing',
            })).toMatchObject({ success: false, error: 'No VFX configured for gifts' });
            expect(h.socket.writes).toHaveLength(baseline);
        } finally { await h.dispose(); }
    });
});
