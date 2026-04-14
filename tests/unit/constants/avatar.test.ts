import { describe, expect, it } from 'bun:test';
import { DEFAULT_AVATAR_URL } from '../../../src/constants/avatar.ts';

describe('avatar constants', () => {
    it('exposes a deterministic default avatar url', () => {
        expect(DEFAULT_AVATAR_URL).toBe('https://yt3.ggpht.com/a/default-user=s88-c-k-c0x00ffffff-no-rj');
    });
});
