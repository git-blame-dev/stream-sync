import { expect, test } from 'bun:test';
import { adaptTikTokEvent } from '../../../src/platforms/tiktok/tiktok-event-adapter';
import { normalizeTikTokChatEvent, normalizeTikTokGiftEvent } from '../../../src/platforms/tiktok/events/event-normalizer';
import { extractTikTokAvatarUrl, extractTikTokUserData } from '../../../src/utils/tiktok-data-extraction';
const common={msgId:'synthetic-message',createTime:'1800000000'};
const user={id:'9000000000000000003',displayId:'synthetic-user',nickname:'Synthetic User',avatarLarge:{urlList:['https://example.invalid/avatar.png']},followInfo:{followStatus:1},badgeImageList:[{urlList:['https://example.invalid/badge.png']}],badgeList:[{combine:{icon:{urlList:['https://example.invalid/combine.png']}},text:{defaultPattern:'Synthetic badge'}}]};
test('standalone emote lists become ordered chat parts without invented text', () => {
    const result = normalizeTikTokChatEvent(adaptTikTokEvent('chat', {
        common, user, userIdentity: { isModeratorOfAnchor: true, isSubscriberOfAnchor: true },
        emoteList: ['synthetic-first', 'synthetic-second'].map(emoteId => ({
            emoteId, image: { urlList: ['', 'invalid', `https://example.invalid/${emoteId}.png`] },
        })),
    }));
    expect(result.message).toEqual({ text: '', parts: [
        { type: 'emote', platform: 'tiktok', emoteId: 'synthetic-first', imageUrl: 'https://example.invalid/synthetic-first.png', placeInComment: 0 },
        { type: 'emote', platform: 'tiktok', emoteId: 'synthetic-second', imageUrl: 'https://example.invalid/synthetic-second.png', placeInComment: 1 },
    ] });
    expect(result).toMatchObject({ userId: 'synthetic-user', username: 'Synthetic User', isMod: true, isPaypiggy: true,
        timestamp: '2027-01-15T08:00:00.000Z', metadata: { profilePicture: 'https://example.invalid/avatar.png' } });
    expect(result.badgeImages).toHaveLength(2);
});
test.each([{ emoteList: [] }, { emoteList: [{ emoteId: '', image: { urlList: ['https://example.invalid/synthetic.png'] } }] },
    { emoteList: [{ emoteId: 'synthetic-invalid', image: { urlList: ['invalid', 'javascript:synthetic'] } }] }, { emoteList: [null] }])(
    'invalid standalone emotes do not invent chat content: %j', ({ emoteList }) => {
        expect(() => normalizeTikTokChatEvent(adaptTikTokEvent('chat', { common, user, emoteList }))).toThrow('Missing TikTok message text');
    },
);
test('v3 emote-only chat preserves identities, privileges, avatar and badge images',()=>{
    const payload=adaptTikTokEvent('chat',{common,user,content:'',userIdentity:{isModeratorOfAnchor:true,isAnchor:true,isSubscriberOfAnchor:true},emotes:[{index:0,emote:{emoteId:'synthetic-emote',image:{urlList:['https://example.invalid/emote.png']}}}]});
    const result=normalizeTikTokChatEvent(payload);
    expect(result.userId).toBe('synthetic-user');expect(result.isMod).toBe(true);expect(result.isBroadcaster).toBe(true);expect(result.isPaypiggy).toBe(true);
    expect(result.message.parts).toEqual([expect.objectContaining({type:'emote',emoteId:'synthetic-emote'})]);
    expect(result.metadata.profilePicture).toBe('https://example.invalid/avatar.png');expect(result.badgeImages).toHaveLength(2);
});
test('v3 live user payload with avatarThumb and undefined avatarLarge preserves avatar across chat and gift normalization',()=>{
    const thumbOnlyUser={id:'9000000000000000004',displayId:'synthetic-thumb-user',nickname:'Synthetic Thumb User',avatarThumb:{urlList:['https://example.invalid/avatar-thumb.webp']},avatarMedium:undefined,avatarLarge:undefined};
    const chatResult=normalizeTikTokChatEvent(adaptTikTokEvent('chat',{common,user:thumbOnlyUser,content:'hello'}));
    expect(chatResult.metadata.profilePicture).toBe('https://example.invalid/avatar-thumb.webp');
    const giftResult=normalizeTikTokGiftEvent(adaptTikTokEvent('gift',{common,user:thumbOnlyUser,gift:{name:'Synthetic Rose',type:1,diamondCount:5,image:{urlList:['https://example.invalid/gift.png']}},repeatCount:1,repeatEnd:1}));
    expect(giftResult.avatarUrl).toBe('https://example.invalid/avatar-thumb.webp');
});
test('v3 image badges, combine badge labels and canonical user key ordering survive 100-key v3 user objects',()=>{
    const rawUserWithManyKeys: Record<string, unknown> = {};
    for (let i = 0; i < 110; i += 1) {
        rawUserWithManyKeys[`syntheticField${i}`] = i;
    }
    Object.assign(rawUserWithManyKeys, {
        id: '9000000000000000005',
        displayId: 'synthetic-badge-user',
        nickname: 'Synthetic Badge User',
        avatarThumb: { urlList: ['https://example.invalid/badge-user-avatar.webp'] },
        badgeList: [
            { displayType: 1, image: { displayType: 0, image: { urlList: ['https://example.invalid/moderator-badge.png'] } } },
            { displayType: 4, combine: { icon: { urlList: ['https://example.invalid/level-badge.png'] }, text: { defaultPattern: 'Level 25' }, str: '25' } },
        ],
    });
    const adapted = adaptTikTokEvent('chat', { common, user: rawUserWithManyKeys, content: 'badge check' });
    const adaptedTopKeys = Object.keys(adapted);
    expect(adaptedTopKeys.slice(0, 6)).toEqual(['msgId', 'isModerator', 'isOwner', 'user', 'comment', 'emotes']);
    const adaptedUserKeys = Object.keys(adapted.user as Record<string, unknown>);
    expect(adaptedUserKeys.slice(0, 8)).toEqual(['userId', 'uniqueId', 'nickname', 'profilePicture', 'followRole', 'userBadges', 'badgeImageList', 'badges']);
    const normalized = normalizeTikTokChatEvent(adapted);
    expect(normalized.metadata.profilePicture).toBe('https://example.invalid/badge-user-avatar.webp');
    expect(normalized.badgeImages).toEqual([
        { imageUrl: 'https://example.invalid/moderator-badge.png', source: 'tiktok', label: '' },
        { imageUrl: 'https://example.invalid/level-badge.png', source: 'tiktok', label: 'Level 25' },
    ]);
});
test('v3 superfan barrage and gift icon fallbacks resolve user and gift image',()=>{
    const barrageAdapted = adaptTikTokEvent('superfan', {
        common,
        commonBarrageContent: {
            pieces: [
                {
                    type: 11,
                    userValue: {
                        user: {
                            id: '9000000000000000006',
                            displayId: 'synthetic-superfan-user',
                            nickname: 'Synthetic Superfan User',
                            avatarThumb: { urlList: ['https://example.invalid/superfan-avatar.webp'] },
                        },
                    },
                },
            ],
        },
    });
    expect(extractTikTokUserData(barrageAdapted)).toEqual({
        userId: 'synthetic-superfan-user',
        username: 'Synthetic Superfan User',
    });
    expect(extractTikTokAvatarUrl(barrageAdapted)).toBe('https://example.invalid/superfan-avatar.webp');

    const iconGiftResult = normalizeTikTokGiftEvent(adaptTikTokEvent('gift', {
        common,
        user,
        gift: {
            name: 'Synthetic Icon Gift',
            type: 1,
            diamondCount: 10,
            image: { urlList: [] },
            icon: { urlList: ['https://example.invalid/gift-icon.png'] },
        },
        repeatCount: 1,
        repeatEnd: 1,
    }));
    expect(iconGiftResult.giftImageUrl).toBe('https://example.invalid/gift-icon.png');
});
test('gift streak accounting and image survive v3 translation',()=>{
    const result=normalizeTikTokGiftEvent(adaptTikTokEvent('gift',{common,user,gift:{name:'Synthetic Rose',type:1,diamondCount:5,image:{urlList:['https://example.invalid/gift.png']}},repeatCount:3,repeatEnd:1,groupId:'synthetic-group'}));
    expect(result.amount).toBe(15);expect(result.repeatEnd).toBe(true);expect(result.groupId).toBe('synthetic-group');expect(result.giftImageUrl).toBe('https://example.invalid/gift.png');
});
test.each([{value:null},{value:[]},{value:undefined}])('invalid payloads do not invent user or gift data: %p',({value})=>{expect(adaptTikTokEvent('gift',value).giftDetails).toBeUndefined();expect(adaptTikTokEvent('social',value).user).toBeUndefined();});
test.each(['','invalid','-1','1.2','9007199254740992'])('invalid viewer count is omitted: %s',total=>{expect(adaptTikTokEvent('roomUser',{total}).viewerCount).toBeUndefined();});

test.each(['0','-1','1.5','invalid'])('invalid subscription duration is omitted: %s',subMonth=>{expect(adaptTikTokEvent('subscribe',{subMonth}).months).toBeUndefined();});
