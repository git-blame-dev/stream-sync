import { expect, test } from 'bun:test';
import { adaptTikTokEvent } from '../../../src/platforms/tiktok/tiktok-event-adapter';
import { normalizeTikTokChatEvent, normalizeTikTokGiftEvent } from '../../../src/platforms/tiktok/events/event-normalizer';
const common={msgId:'synthetic-message',createTime:'1800000000'};
const user={id:'9000000000000000003',displayId:'synthetic-user',nickname:'Synthetic User',avatarLarge:{urlList:['https://example.invalid/avatar.png']},followInfo:{followStatus:1},badgeImageList:[{urlList:['https://example.invalid/badge.png']}],badgeList:[{combine:{icon:{urlList:['https://example.invalid/combine.png']}},text:{defaultPattern:'Synthetic badge'}}]};
test('v3 emote-only chat preserves identities, privileges, avatar and badge images',()=>{
    const payload=adaptTikTokEvent('chat',{common,user,content:'',userIdentity:{isModeratorOfAnchor:true,isAnchor:true,isSubscriberOfAnchor:true},emotes:[{index:0,emote:{emoteId:'synthetic-emote',image:{urlList:['https://example.invalid/emote.png']}}}]});
    const result=normalizeTikTokChatEvent(payload);
    expect(result.userId).toBe('synthetic-user');expect(result.isMod).toBe(true);expect(result.isBroadcaster).toBe(true);expect(result.isPaypiggy).toBe(true);
    expect(result.message.parts).toEqual([expect.objectContaining({type:'emote',emoteId:'synthetic-emote'})]);
    expect(result.metadata.profilePicture).toBe('https://example.invalid/avatar.png');expect(result.badgeImages).toHaveLength(2);
});
test('gift streak accounting and image survive v3 translation',()=>{
    const result=normalizeTikTokGiftEvent(adaptTikTokEvent('gift',{common,user,gift:{name:'Synthetic Rose',type:1,diamondCount:5,image:{urlList:['https://example.invalid/gift.png']}},repeatCount:3,repeatEnd:1,groupId:'synthetic-group'}));
    expect(result.amount).toBe(15);expect(result.repeatEnd).toBe(true);expect(result.groupId).toBe('synthetic-group');expect(result.giftImageUrl).toBe('https://example.invalid/gift.png');
});
test.each([{value:null},{value:[]},{value:undefined}])('invalid payloads do not invent user or gift data: %p',({value})=>{expect(adaptTikTokEvent('gift',value).giftDetails).toBeUndefined();expect(adaptTikTokEvent('social',value).user).toBeUndefined();});
test.each(['','invalid','-1','1.2','9007199254740992'])('invalid viewer count is omitted: %s',total=>{expect(adaptTikTokEvent('roomUser',{total}).viewerCount).toBeUndefined();});

test.each(['0','-1','1.5','invalid'])('invalid subscription duration is omitted: %s',subMonth=>{expect(adaptTikTokEvent('subscribe',{subMonth}).months).toBeUndefined();});
