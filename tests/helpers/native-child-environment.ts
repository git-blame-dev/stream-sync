import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withNativeChildEnvironment<T>(
    run: (env: NodeJS.ProcessEnv) => T | Promise<T>,
): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), 'synthetic-native-environment-'));
    try {
        const configPath = join(directory, 'config.ini');
        await writeFile(configPath,
            '[general]\nenvFileReadEnabled=false\nenvFileWriteEnabled=false\n' +
            '[logging]\nfileLoggingEnabled=false\n');
        return await run({
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            CHAT_BOT_CONFIG_PATH: configPath,
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
