import { expect, test } from 'bun:test'
import { createTestAppRuntime } from '../../helpers/runtime-test-harness'
import { createGuiTransportService } from '../../../src/services/gui/gui-transport-service'
import { createConfigFixture } from '../../helpers/config-fixture'
import { EventBus } from '../../../src/core/EventBus'

for (const enabled of [false, true]) {
  test(`runtime and real transport share chat-only activation (${enabled})`, async () => {
    const config = createConfigFixture({
      gui: { enableDock: false, enableOverlay: false, enableNotifications: false,
        enableOperator: false, enableChatFeed: enabled, host: '127.0.0.1', port: 0 },
      fundingGoal: { enabled: false },
    })
    let listens = 0
    const transport = createGuiTransportService({ config, eventBus: new EventBus(), logger: null,
      createServer: () => ({ once: () => undefined, on: () => undefined, removeListener: () => undefined,
        listen: (_port, _host, callback) => { listens++; callback?.() },
        address: () => null, close: callback => callback?.(),
      }),
    })
    const { runtime } = createTestAppRuntime({ gui: config.gui }, { guiTransportService: transport })
    try {
      await runtime._startGuiTransport()
      expect(listens).toBe(enabled ? 1 : 0)
      expect(transport.isActive()).toBe(enabled)
    } finally { await runtime.shutdown() }
  })
}
