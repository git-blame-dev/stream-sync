import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';
import { TikTokPlatform } from '../../../src/platforms/tiktok';
import { TikTokWebSocketClient } from '../../../src/platforms/tiktok-websocket-client';
import { RetrySystem } from '../../../src/utils/retry-system';
import { createMockTikTokPlatformDependencies, noOpLogger } from '../../helpers/mock-factories';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
import { useFakeTimers, useRealTimers } from '../../helpers/bun-timers';
beforeEach(()=>useFakeTimers());afterEach(()=>useRealTimers());
test.each([
    {label:'recoverable startup',code:1011,initialize:false,cancel:false,expected:1},
    {label:'terminal authentication',code:4401,initialize:false,cancel:false,expected:0},
    {label:'terminal permissions',code:4403,initialize:false,cancel:false,expected:0},
    {label:'intentional shutdown',code:1000,initialize:false,cancel:true,expected:0},
    {label:'registered startup recovery',code:1011,initialize:true,cancel:false,expected:1},
])('$label retains exactly one retry owner',async({code,initialize,cancel,expected})=>{
    const sdk=new SyntheticTikTokConnector();
    const client=new TikTokWebSocketClient('synthetic-streamer',{connectorFactory:async()=>sdk});
    const retry=new RetrySystem({logger:noOpLogger});let requests=0;
    const platform=new TikTokPlatform({enabled:true,username:'synthetic-streamer'},{
        ...createMockTikTokPlatformDependencies(),logger:noOpLogger,
        WebcastEvent:{CHAT:'chat',GIFT:'gift',FOLLOW:'follow',SOCIAL:'social',ROOM_USER:'roomUser',ERROR:'error',DISCONNECT:'disconnected',STREAM_END:'streamEnd'},
        ControlEvent:{CONNECTED:'connected',DISCONNECTED:'disconnected',ERROR:'error'},
        connectionFactory:{createConnection:()=>client},
        retrySystem:{resetRetryCount:retry.resetRetryCount.bind(retry),cancelConnectionRetry:retry.cancelConnectionRetry.bind(retry),handleConnectionError:(...args:Parameters<typeof retry.handleConnectionError>)=>{requests++;return retry.handleConnectionError(...args);}},
    });
    const lifecycle=new PlatformLifecycleService({logger:noOpLogger});
    try {
        lifecycle.platforms.tiktok=platform;
        const pending=initialize?lifecycle.initializePlatformConnection('tiktok',platform,lifecycle.resolveEventHandlers('tiktok',null),{enabled:true}):platform._connect({});
        const result=pending.then(()=>null,error=>error);
        await flushConnectorSetup();
        if(cancel)await platform.cleanup();else sdk.fail(Object.assign(new Error('synthetic failure'),{code}));
        await result;await flushConnectorSetup();
        if(initialize){await lifecycle.backgroundPlatformInits[0]?.promise;expect(lifecycle.getPlatform('tiktok')).toBe(platform);expect(lifecycle.getStatus().recoveringPlatforms).toEqual([expect.objectContaining({name:'tiktok'})]);}
        expect(requests).toBe(expected);expect(retry.getRetryCount('tiktok')).toBe(expected);
    } finally {await platform.cleanup();retry.dispose();}
});
