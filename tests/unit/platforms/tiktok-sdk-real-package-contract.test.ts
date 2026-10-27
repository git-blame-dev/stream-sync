import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
test('actual SDK wire decoding, application mapping, signer validation and cancellation',()=>{
    const result=spawnSync(process.execPath,['test','--config',resolve(import.meta.dir,'../../fixtures/tiktok-sdk-bunfig.toml'),'--coverage','--coverage-reporter=text','--coverage-dir=/tmp/stream-sync-real-sdk-coverage',resolve(import.meta.dir,'../../fixtures/tiktok-sdk-contract.ts')],{cwd:tmpdir(),encoding:'utf8',timeout:20000,env:{...process.env,TIKTOK_API_KEY:''}});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"wireChat":true');
    expect(result.stdout).toContain('"wireGift":true');
    expect(result.stdout).toContain('"wireViewers":true');
    expect(result.stdout).toContain('"wireSubscription":true');
    expect(result.stdout).toContain('"destinationGuard":true');
    expect(result.stdout).toContain('"signingCancellation":true');
    expect(result.stdout).toContain('"lateSocketCancellation":true');
    expect(result.stdout).toContain('"httpStatusClassification":true');
},25000);
