import { acquireSingleInstanceGuard } from '../../src/services/SingleInstanceGuard';

async function run() {
    const guard = await acquireSingleInstanceGuard({ port: Number(process.argv[2] ?? 0) });
    if (process.argv[3] === 'hold') {
        process.stdin.resume();
        process.stdin.once('data', () => {
            void guard.release().then(() => process.stdin.pause());
        });
    }
    process.stdout.write(`${guard.port}\n`);
}

void run().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
