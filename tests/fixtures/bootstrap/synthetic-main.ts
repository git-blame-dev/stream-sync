import assert from 'node:assert/strict';

const scenario = process.env.SYNTHETIC_BOOTSTRAP_CASE;

if (scenario === 'import-failure') {
    throw new Error('synthetic import failure Authorization: Bearer synthetic-bootstrap-token');
}
assert.ok(process.listenerCount('uncaughtException') > 0, 'emergency handler must precede main import');
assert.ok(process.listenerCount('unhandledRejection') > 0, 'rejection handler must precede main import');

export async function main(): Promise<void> {
    switch (scenario) {
        case 'main-failure':
            throw new Error('synthetic main failure');
        case 'uncaught-exception':
            queueMicrotask(() => { throw new Error('synthetic uncaught failure'); });
            break;
        case 'unhandled-rejection':
            void Promise.reject(new Error('synthetic rejection failure'));
            await new Promise<void>(resolve => setImmediate(resolve));
            break;
        case 'debug':
            assert.ok(process.argv.includes('--debug'));
            break;
        case 'help':
            assert.ok(process.argv.includes('--help'));
            process.stdout.write('synthetic CLI help\n');
            break;
    }
}
