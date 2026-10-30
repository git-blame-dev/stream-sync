import { test } from 'bun:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, RouteConfig, ControlEvent } from 'tiktok-live-connector';
import { ProtoMessageFetchResult, BaseProtoMessage, WebcastPushFrame, WebcastChatMessage, WebcastEmoteChatMessage, WebcastGiftMessage, WebcastRoomUserSeqMessage, WebcastSubNotifyMessage, WebcastSocialMessage, WebcastBarrageMessage, CommonMessageData, User, Gift, ImageModel, UserIdentity, BadgeStruct, ImageBadge, CombineBadgeStruct, EmoteModel } from 'tiktok-live-proto/v3';
import { TikTokWebSocketClient, type Connector } from '../../src/platforms/tiktok-websocket-client';
import { createTikTokConnector } from '../../src/platforms/tiktok/tiktok-connector';
import { createTikTokEventFactory } from '../../src/platforms/tiktok/events/event-factory';
import { normalizeTikTokChatEvent, normalizeTikTokGiftEvent } from '../../src/platforms/tiktok/events/event-normalizer';
import { initializeLoggingConfig } from '../../src/core/logging';
initializeLoggingConfig({logging:{console:{enabled:false},file:{enabled:false}}},{operatorCaptureEnabled:false});
const empty=new Uint8Array();
const roomId='9000000000000000001';
const common={...CommonMessageData.decode(empty),msgId:'9000000000000000002',createTime:'1800000000'};
const image = (name: string) => ({ ...ImageModel.decode(empty), urlList: [`https://example.invalid/synthetic-${name}.png`] });
const user={...User.decode(empty),id:'9000000000000000003',displayId:'synthetic-viewer',nickname:'Synthetic Viewer',
    avatarThumb: image('avatar'), badgeList: [
        { ...BadgeStruct.decode(empty), displayType: 1, image: { ...ImageBadge.decode(empty), image: image('image-badge') } },
        { ...BadgeStruct.decode(empty), displayType: 4, combine: { ...CombineBadgeStruct.decode(empty), icon: image('combine-badge'), str: 'Synthetic badge' } },
    ] };
const userIdentity = { ...UserIdentity.decode(empty), isModeratorOfAnchor: true, isSubscriberOfAnchor: true };
const emote = { ...EmoteModel.decode(empty), emoteId: 'synthetic-emote', image: image('emote') };
const expectedBadges = [
    { imageUrl: 'https://example.invalid/synthetic-image-badge.png', source: 'tiktok', label: '' },
    { imageUrl: 'https://example.invalid/synthetic-combine-badge.png', source: 'tiktok', label: 'Synthetic badge' },
];
function frame(type:string,payload:Uint8Array=empty){return WebcastPushFrame.encode({...WebcastPushFrame.decode(empty),payloadEncoding:'pb',payloadType:type,payload:Buffer.from(payload)}).finish();}
function message(method:string,payload:Uint8Array){return frame('msg',ProtoMessageFetchResult.encode({...ProtoMessageFetchResult.decode(empty),messages:[{...BaseProtoMessage.decode(empty),method,payload:Buffer.from(payload)}]}).finish());}

async function main(){
    const originalSigner=RouteConfig.fetchSignedWebSocketFromProvider;
    const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
    RouteConfig.fetchRoomIdComposite=async()=>roomId;
    RouteConfig.fetchRoomInfo=async()=>({data:{status:2}});
    RouteConfig.fetchSignedWebSocketFromProvider=async()=>({fetchResult:{...ProtoMessageFetchResult.decode(empty),cursor:'synthetic-cursor',pushServer:`ws://127.0.0.1:${address.port}`},fetchResultCookieHeader:'synthetic-cookie=test-only',fetchResultRoomId:roomId});
    server.on('connection',socket=>socket.on('message',raw=>{if(WebcastPushFrame.decode(new Uint8Array(raw as Buffer)).payloadType==='im_enter_room')socket.send(frame('im_enter_room_resp'));}));
    const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>new TikTokLiveConnection('synthetic-streamer',{processInitialData:false,enableExtendedGiftInfo:false}) as unknown as Connector});
    try{
        await client.connect();assert.equal(client.isConnected,true);
        const chat=once(client,'chat',{signal:AbortSignal.timeout(2000)});const gift=once(client,'gift',{signal:AbortSignal.timeout(2000)});const viewer=once(client,'roomUser',{signal:AbortSignal.timeout(2000)});const subscription=once(client,'subscribe',{signal:AbortSignal.timeout(2000)});
        for(const socket of server.clients){
            socket.send(message('WebcastChatMessage',WebcastChatMessage.encode({...WebcastChatMessage.decode(empty),common,user,userIdentity,content:'synthetic hello',emotes:[{index:0,emote}]}).finish()));
            socket.send(message('WebcastGiftMessage',WebcastGiftMessage.encode({...WebcastGiftMessage.decode(empty),common,user,repeatCount:3,repeatEnd:1,gift:{...Gift.decode(empty),name:'Synthetic Rose',diamondCount:5,type:1,icon:image('gift')}}).finish()));
            socket.send(message('WebcastSubNotifyMessage',WebcastSubNotifyMessage.encode({...WebcastSubNotifyMessage.decode(empty),common,user,subMonth:'3'}).finish()));
            socket.send(message('WebcastRoomUserSeqMessage',WebcastRoomUserSeqMessage.encode({...WebcastRoomUserSeqMessage.decode(empty),total:'4'}).finish()));
        }
        const chatPayload = (await chat)[0];
        const normalizedChat = normalizeTikTokChatEvent(chatPayload);
        assert.equal(chatPayload.msgId, common.msgId);
        assert.equal(normalizedChat.message.text,'synthetic hello');
        assert.equal(normalizedChat.userId, 'synthetic-viewer');
        assert.equal(normalizedChat.timestamp, '2027-01-15T08:00:00.000Z');
        assert.equal(normalizedChat.isMod, true);
        assert.equal(normalizedChat.isPaypiggy, true);
        assert.equal(normalizedChat.metadata.profilePicture, 'https://example.invalid/synthetic-avatar.png');
        assert.deepEqual(normalizedChat.badgeImages, expectedBadges);
        assert.deepEqual(normalizedChat.message.parts?.[0], {type:'emote',platform:'tiktok',emoteId:'synthetic-emote',imageUrl:'https://example.invalid/synthetic-emote.png',placeInComment:0});
        const normalizedGift = normalizeTikTokGiftEvent((await gift)[0]);
        assert.equal(normalizedGift.amount,15);
        assert.equal(normalizedGift.avatarUrl, 'https://example.invalid/synthetic-avatar.png');
        assert.equal(normalizedGift.giftImageUrl, 'https://example.invalid/synthetic-gift.png');
        assert.equal(normalizedGift.id, common.msgId);
        assert.equal(normalizedGift.timestamp, normalizedChat.timestamp);
        assert.equal((await viewer)[0].viewerCount,4);
        const subscribed = createTikTokEventFactory().createSubscription((await subscription)[0]);
        assert.equal(subscribed.months,3);
        assert.equal(subscribed.avatarUrl, 'https://example.invalid/synthetic-avatar.png');

        const standalone = once(client, 'chat', { signal: AbortSignal.timeout(2000) });
        for (const socket of server.clients) socket.send(message('WebcastEmoteChatMessage', WebcastEmoteChatMessage.encode({
            ...WebcastEmoteChatMessage.decode(empty), common, user, userIdentity, emoteList: [emote, { ...emote, emoteId: 'synthetic-second' }],
        }).finish()));
        const standalonePayload = (await standalone)[0];
        const normalizedEmotes = normalizeTikTokChatEvent(standalonePayload);
        assert.equal(standalonePayload.msgId, common.msgId);
        assert.equal(normalizedEmotes.message.text, '');
        assert.deepEqual(normalizedEmotes.message.parts?.map(part => part.emoteId), ['synthetic-emote', 'synthetic-second']);
        assert.equal(normalizedEmotes.metadata.profilePicture, normalizedChat.metadata.profilePicture);
        assert.deepEqual(normalizedEmotes.badgeImages, expectedBadges);
        assert.equal(normalizedEmotes.isMod, true);
        assert.equal(normalizedEmotes.timestamp, normalizedChat.timestamp);

        for (const action of ['follow', 'share']) {
            const social = once(client, action, { signal: AbortSignal.timeout(2000) });
            for (const socket of server.clients) socket.send(message('WebcastSocialMessage', WebcastSocialMessage.encode({
                ...WebcastSocialMessage.decode(empty), user,
                common: { ...common, displayText: { defaultPattern: '', defaultFormat: undefined, pieces: [], key: `synthetic_${action}` } },
            }).finish()));
            const payload = (await social)[0];
            assert.equal(payload.msgId, common.msgId);
            assert.equal(payload.user.uniqueId, 'synthetic-viewer');
            assert.equal(payload.user.profilePicture.url[0], 'https://example.invalid/synthetic-avatar.png');
        }
        const memberships: unknown[] = [];
        client.on('superfan', data => memberships.push(data));
        const purchase = once(client, 'superfan', { signal: AbortSignal.timeout(2000) });
        for (const socket of server.clients) {
            socket.send(message('WebcastBarrageMessage', WebcastBarrageMessage.encode({ ...WebcastBarrageMessage.decode(empty), common, user,
                content: { defaultPattern: '', defaultFormat: undefined, pieces: [], key: 'ttlive_superFan_commentNotif_superFanJoined' }, msgType: 11 }).finish()));
            socket.send(message('WebcastBarrageMessage', WebcastBarrageMessage.encode({ ...WebcastBarrageMessage.decode(empty), common, user,
                content: { defaultPattern: '', defaultFormat: undefined, pieces: [], key: 'ttlive_superFan_synthetic_purchase' }, msgType: 4 }).finish()));
        }
        const member = (await purchase)[0];
        assert.equal(memberships.length, 1);
        assert.equal(createTikTokEventFactory().createSuperfan(member).avatarUrl, 'https://example.invalid/synthetic-avatar.png');
        client.disconnect();assert.equal(client.isConnected,false);
    }finally{client.disconnect();for(const socket of server.clients)socket.terminate();server.close();}

    // The actual default factory validates signer destinations before opening a socket.
    const abort=new AbortController();const guarded=await createTikTokConnector('synthetic-streamer','synthetic-key',abort.signal);
    guarded.on(ControlEvent.ERROR,()=>{});
    await assert.rejects(guarded.connect(),/Invalid TikTok WebSocket destination/);abort.abort();await guarded.disconnect();
    // Cancellation must reach the signer's per-attempt HTTP options, not just hide its result.
    const controller=new AbortController();let enteredSigner:()=>void=()=>{};const signerStarted=new Promise<void>(resolve=>{enteredSigner=resolve;});
    RouteConfig.fetchSignedWebSocketFromProvider=async({apiClient})=>new Promise((_resolve,reject)=>{const signal=apiClient.configuration.baseOptions.signal as AbortSignal;signal.addEventListener('abort',()=>reject(new Error('synthetic cancellation')),{once:true});enteredSigner();});
    const cancelled=await createTikTokConnector('synthetic-streamer','synthetic-key',controller.signal);cancelled.on(ControlEvent.ERROR,()=>{});

    const pending=cancelled.connect();const rejection=assert.rejects(pending,/synthetic cancellation/);await signerStarted;controller.abort();await rejection;await cancelled.disconnect();
    // Pause the SDK's cookie await exactly before socket construction.
    const lateAbort=new AbortController();const late=await createTikTokConnector('synthetic-streamer','synthetic-key',lateAbort.signal);
    let cookieStarted:()=>void=()=>{};const cookieWaiting=new Promise<void>(resolve=>{cookieStarted=resolve;});
    let resumeCookie:(value:string)=>void=()=>{};
    late.webClient.cookieJar.getAnonymousCookieString=()=>{cookieStarted();return new Promise<string>(resolve=>{resumeCookie=resolve;});};
    RouteConfig.fetchSignedWebSocketFromProvider=async()=>({fetchResult:{...ProtoMessageFetchResult.decode(empty),cursor:'synthetic-cursor',pushServer:'wss://webcast-ws.tiktok.com'},fetchResultCookieHeader:'synthetic-cookie=test-only',fetchResultRoomId:roomId});
    // Keep even a regressed socket constructor local; retain the real scoped provider guard.
    const lateServer=new WebSocketServer({host:'127.0.0.1',port:0});await once(lateServer,'listening');const lateAddr=lateServer.address();assert.ok(lateAddr&&typeof lateAddr!=='string');
    let lateConnections=0;lateServer.on('connection',()=>{lateConnections++;});
    type Provider = { _wsClientProvider: (params: Record<string,unknown>) => unknown };
    const boundary=late as unknown as Provider;const provide=boundary._wsClientProvider;
    boundary._wsClientProvider=params=>provide({...params,baseUrl:`ws://127.0.0.1:${lateAddr.port}`});
    late.on(ControlEvent.ERROR,()=>{});
    const latePending=late.connect();const lateRejected=assert.rejects(latePending);await cookieWaiting;lateAbort.abort();await late.disconnect();resumeCookie('synthetic-cookie=test-only');await lateRejected;
    assert.equal(late.wsClient,null);assert.equal(late.isConnected,false);assert.equal(lateConnections,0);lateServer.close();
    RouteConfig.fetchSignedWebSocketFromProvider=originalSigner;
    for(const status of [401,403,429]) {
        const http=createServer((_request,response)=>{response.writeHead(status,{'content-type':'application/json','retry-after':'1'});response.end(JSON.stringify({message:'synthetic refusal'}));});
        http.listen(0,'127.0.0.1');await once(http,'listening');const addr=http.address();assert.ok(addr&&typeof addr!=='string');
        const wrapped=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async(username,key,signal)=>{
            const actual=await createTikTokConnector(username,key,signal);actual.apiClient.configuration.basePath=`http://127.0.0.1:${addr.port}`;return actual as unknown as Connector;
        }});
        try {await assert.rejects(wrapped.connect(),error=>!!(error&&typeof error==='object'&&'code' in error&&error.code===(status===401?4401:status===403?4403:4429)));}
        finally {wrapped.disconnect();http.closeAllConnections();http.close();}
    }
    process.stdout.write(JSON.stringify({wireChat:true,wireGift:true,wireViewers:true,wireSubscription:true,wireEmotes:true,wireMedia:true,wireSocial:true,wireMembershipAliases:true,destinationGuard:true,signingCancellation:true,lateSocketCancellation:true,httpStatusClassification:true})+'\n');
}
test('actual TikTok SDK transport and signer contracts',main,15000);
