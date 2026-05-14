import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { config: baseConfig } = load('../../src/core/config');
const { logger } = load('../../src/core/logging');
const { createGuiTransportService } = load('../../src/services/gui/gui-transport-service');

type UnknownRecord = Record<string, unknown>;

interface DemoService {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAddress: () => { port?: number } | string | null;
}

function toRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as UnknownRecord) }
    : {};
}

async function runGuiDemo(): Promise<void> {
  const guiConfig = toRecord(baseConfig.gui);
  const config = toRecord(baseConfig);

  const service: DemoService = createGuiTransportService({
    config,
    logger,
    demoOnly: true
  });

  await service.start();

  const host = typeof guiConfig.host === 'string' ? guiConfig.host : '127.0.0.1';
  const address = service.getAddress();
  const port = address && typeof address === 'object' && typeof address.port === 'number'
    ? address.port
    : Number(guiConfig.port);
  process.stdout.write(`Demo URL: http://${host}:${port}/demo\n`);

  const stop = async () => {
    await service.stop();
  };

  process.once('SIGINT', () => {
    stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });

  process.once('SIGTERM', () => {
    stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

if (require.main === module) {
  runGuiDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`GUI demo failed: ${message}\n`);
    process.exit(1);
  });
}

export { runGuiDemo };
