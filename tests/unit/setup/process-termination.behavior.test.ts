import { expect, test } from 'bun:test';
import { dirname } from 'node:path';
import { withNativeChildEnvironment } from '../../helpers/native-child-environment';

for (const lingeringHandle of [false, true]) {
    test(`production shutdown composition preserves native exit with lingering handle ${lingeringHandle}`, async () => {
        await withNativeChildEnvironment(async env => {
            const script = `
                import { createProductionDependencies } from ${JSON.stringify(import.meta.resolve('../../../src/main.ts'))};
                const dependencies = createProductionDependencies({}, {
                    connectionManager: {}, sourcesManager: {}, effectsManager: {}, goalsManager: {},
                });
                dependencies.logging.error = () => { throw new Error('Synthetic failed diagnostic'); };
                process.on('exit', code => process.stdout.write('NATIVE_EXIT:' + code));
                ${lingeringHandle ? "setInterval(() => {}, 60000);" : ""}
                process.exitCode = 19;
                dependencies.onShutdownComplete();
                process.stdout.write('SHUTDOWN_CODE:' + process.exitCode);
            `;
            const child = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', script], {
                cwd: dirname(env.CHAT_BOT_CONFIG_PATH!), env, stdout: 'pipe', stderr: 'pipe', timeout: 5000,
            });
            expect(child.exitCode).toBe(0);
            expect(child.stdout.toString()).toContain('SHUTDOWN_CODE:0');
            expect(child.stdout.toString()).toContain('NATIVE_EXIT:0');
            expect(child.stderr.toString()).toBe('');
        });
    });
}
