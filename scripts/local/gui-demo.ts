import { createRequire } from 'node:module';
import { buildSyntheticGuiConfig } from './gui-synthetic-config';

const load = createRequire(__filename);

type UnknownRecord = Record<string, unknown>;

interface DemoService {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAddress: () => { port?: number } | string | null;
}

interface GuiDemoOptions {
  baseConfig?: unknown;
  logger?: unknown;
  createGuiTransportServiceImpl?: (options: { config: UnknownRecord; logger: unknown; demoOnly: boolean }) => DemoService;
  process?: {
    once: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown;
    exit: (code: number) => void;
    stdout: { write: (text: string) => unknown };
  };
}

function toRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as UnknownRecord) }
    : {};
}

function buildGuiDemoConfig(source: unknown): UnknownRecord {
  const config = toRecord(source);
  return {
    ...config,
    gui: {
      ...toRecord(config.gui),
      enableOperator: false
    }
  };
}

async function runGuiDemo(options: GuiDemoOptions = {}): Promise<void> {
  const logger = options.logger || load('../../src/core/logging').logger;
  const createGuiTransportService = options.createGuiTransportServiceImpl || load('../../src/services/gui/gui-transport-service').createGuiTransportService;
  const hostProcess = options.process || process;
  const config = buildGuiDemoConfig(options.baseConfig ?? buildSyntheticGuiConfig());
  const guiConfig = toRecord(config.gui);

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
  hostProcess.stdout.write(`Demo URL: http://${host}:${port}/demo\n`);

  const stop = async () => {
    await service.stop();
  };

  hostProcess.once('SIGINT', () => {
    stop()
      .then(() => hostProcess.exit(0))
      .catch(() => hostProcess.exit(1));
  });

  hostProcess.once('SIGTERM', () => {
    stop()
      .then(() => hostProcess.exit(0))
      .catch(() => hostProcess.exit(1));
  });
}

if (require.main === module) {
  runGuiDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`GUI demo failed: ${message}\n`);
    process.exit(1);
  });
}

export { buildGuiDemoConfig, runGuiDemo };
