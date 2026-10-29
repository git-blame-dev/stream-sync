import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('local GUI command import isolation', () => {
    for (const script of ['gui-preview', 'gui-demo', 'gui-gift-animation-preview', 'gui-synthetic-config']) {
        it(`imports ${script} without runtime effects under tsx and Bun`, async () => {
            const directory = await mkdtemp(path.join(tmpdir(), 'gui-import-'));
            const root = path.resolve(__dirname, '../../..');
            const target = path.join(root, 'scripts/local', `${script}.ts`);
            const entry = path.join(directory, 'import-only.ts');
            try {
                await writeFile(entry, `
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(path.join(root, 'package.json'))});
const effects: string[] = [];
const forbidden = (operation: string) => { effects.push(operation); throw new Error('IMPORT_EFFECT:' + operation); };
const originalRead = fs.readFileSync.bind(fs);
const originalExists = fs.existsSync.bind(fs);
const isRuntimeFile = (value: unknown) => /(?:^|[/\\\\])(?:config\\.ini|\\.env|synthetic-bait\\.ini)(?:$|[/\\\\])/.test(String(value));
fs.readFileSync = ((file: unknown, ...args: unknown[]) => {
    if (isRuntimeFile(file)) return forbidden('runtime-read');
    return (originalRead as Function)(file, ...args);
}) as typeof fs.readFileSync;
fs.existsSync = ((file: unknown) => {
    if (isRuntimeFile(file)) return forbidden('runtime-exists');
    return originalExists(file as string);
}) as typeof fs.existsSync;
fs.mkdirSync = (() => forbidden('mkdir')) as typeof fs.mkdirSync;
fs.appendFileSync = (() => forbidden('append')) as typeof fs.appendFileSync;
fsPromises.mkdir = (() => forbidden('async-mkdir')) as typeof fsPromises.mkdir;
fsPromises.readFile = ((file: unknown) => forbidden('async-read:' + String(file))) as typeof fsPromises.readFile;
globalThis.setTimeout = (() => forbidden('timeout')) as typeof setTimeout;
globalThis.setInterval = (() => forbidden('interval')) as typeof setInterval;
globalThis.fetch = (() => forbidden('fetch')) as typeof fetch;
if (typeof Bun !== 'undefined') Bun.serve = (() => forbidden('bun-serve')) as typeof Bun.serve;
net.Server.prototype.listen = (() => forbidden('listen')) as typeof net.Server.prototype.listen;
net.Socket.prototype.connect = (() => forbidden('connect')) as typeof net.Socket.prototype.connect;
const command = require(${JSON.stringify(target)});
if (command.buildPreviewConfig) {
    const config = command.buildPreviewConfig();
    if (config.twitch.clientId !== '' || config.gui.overlayMaxMessages !== 6) throw new Error('Invalid synthetic preview defaults');
}
if (command.buildSyntheticGuiConfig && command.buildSyntheticGuiConfig().twitch.clientId !== '') throw new Error('Credential inherited');
if (effects.length) throw new Error('IMPORT_EFFECTS:' + effects.join(','));
process.stdout.write('IMPORT_OK');
`);
                for (const command of [
                    ['node', '--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), entry],
                    [process.execPath, '--no-env-file', entry]
                ]) {
                    const child = Bun.spawn(command, {
                        cwd: directory,
                        env: { PATH: process.env.PATH, CHAT_BOT_CONFIG_PATH: path.join(directory, 'synthetic-bait.ini'), TWITCH_CLIENT_ID: 'synthetic-must-not-inherit' },
                        stdout: 'pipe', stderr: 'pipe', timeout: 10000
                    });
                    const [stdout, stderr, exitCode] = await Promise.all([
                        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
                    ]);
                    expect({ exitCode, stderr, stdout }).toEqual({ exitCode: 0, stderr: '', stdout: 'IMPORT_OK' });
                }
            } finally {
                await rm(directory, { recursive: true, force: true });
            }
        });
    }
});
