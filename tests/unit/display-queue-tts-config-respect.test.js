
const { DisplayQueue } = require('../../src/obs/display-queue');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('DisplayQueue TTS Configuration Respect', () => {
  let mockOBSManager;
  let displayQueue;
  let runtimeConstants;
  const baseConstants = { PRIORITY_LEVELS: { CHAT: 1 } };
  
  beforeEach(() => {
    // Create simple mock OBS manager
    mockOBSManager = {
      isReady: jest.fn().mockResolvedValue(true),
      call: jest.fn().mockResolvedValue({ inputSettings: {} })
    };
    runtimeConstants = createRuntimeConstantsFixture();
  });

  describe('when ttsEnabled is explicitly false', () => {
    beforeEach(() => {
      const config = {
        ttsEnabled: false, // Explicitly disabled
        chat: {
          sourceName: 'chat msg txt',
          sceneName: 'v efx statusbar',
          groupName: 'statusbar chat grp',
          platformLogos: {
            youtube: 'youtube-img'
          }
        },
        obs: {
          ttsTxt: 'tts txt'
        }
      };
      displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null, runtimeConstants);
    });

    it('should return false for isTTSEnabled()', () => {
      expect(displayQueue.isTTSEnabled()).toBe(false);
    });

    it('should NOT send TTS text when processing chat message', async () => {
      const chatItem = {
        type: 'chat',
        platform: 'youtube',
        data: {
          username: 'TestUser',
          message: 'Hello world'
        }
      };

      await displayQueue.handleChatMessageTTS(chatItem);

      // Verify TTS text source was NOT called
      const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call => 
        call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
      );
      
      expect(ttsCallsOnly).toHaveLength(0);
      expect(mockOBSManager.call).not.toHaveBeenCalledWith('SetInputSettings', 
        expect.objectContaining({
          inputName: 'tts txt'
        })
      );
    });

    it('should skip TTS processing when explicitly disabled', async () => {
      const chatItem = {
        type: 'chat',
        platform: 'youtube',
        data: {
          username: 'TestUser',
          message: 'Hello world'
        }
      };

      await displayQueue.handleChatMessageTTS(chatItem);

      // The key test: when TTS is disabled, OBS calls should be zero for TTS text source
      const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call => 
        call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
      );
      
      expect(ttsCallsOnly).toHaveLength(0);
    });
  });

  describe('when ttsEnabled is explicitly true', () => {
    beforeEach(() => {
      const config = {
        ttsEnabled: true, // Explicitly enabled
        chat: {
          sourceName: 'chat msg txt',
          sceneName: 'v efx statusbar', 
          groupName: 'statusbar chat grp',
          platformLogos: {
            youtube: 'youtube-img'
          }
        },
        obs: {
          ttsTxt: 'tts txt'
        }
      };
      displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null, runtimeConstants);
    });

    it('should return true for isTTSEnabled()', () => {
      expect(displayQueue.isTTSEnabled()).toBe(true);
    });

    it('should NOT send TTS text when processing chat message (chat TTS is disabled by design)', async () => {
      const chatItem = {
        type: 'chat',
        platform: 'youtube',
        data: {
          username: 'TestUser',
          message: 'Hello world'
        }
      };

      await displayQueue.handleChatMessageTTS(chatItem);

      // Verify TTS text source was NOT called (chat TTS is intentionally disabled)
      const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call => 
        call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
      );
      
      expect(ttsCallsOnly.length).toBe(0);
      expect(mockOBSManager.call).not.toHaveBeenCalledWith('SetInputSettings', 
        expect.objectContaining({
          inputName: 'tts txt'
        })
      );
    });
  });

  describe('when ttsEnabled is undefined (edge case)', () => {
    beforeEach(() => {
      const config = {
        // ttsEnabled NOT SET - should default to backward compatibility (true)
        chat: {
          sourceName: 'chat msg txt',
          sceneName: 'v efx statusbar',
          groupName: 'statusbar chat grp',
          platformLogos: {
            youtube: 'youtube-img'
          }
        },
        obs: {
          ttsTxt: 'tts txt'
        }
      };
      displayQueue = new DisplayQueue(mockOBSManager, config, baseConstants, null, runtimeConstants);
    });

    it('should return false for isTTSEnabled() when config is undefined', () => {
      // Undefined should default to false for safety, not true
      expect(displayQueue.isTTSEnabled()).toBe(false);
    });

    it('should NOT send TTS text when config is undefined', async () => {
      const chatItem = {
        type: 'chat',
        platform: 'youtube',
        data: {
          username: 'TestUser',
          message: 'Hello world'
        }
      };

      await displayQueue.handleChatMessageTTS(chatItem);

      // Undefined config should NOT enable TTS (safety-first)
      const ttsCallsOnly = mockOBSManager.call.mock.calls.filter(call => 
        call[0] === 'SetInputSettings' && call[1].inputName === 'tts txt'
      );
      
      expect(ttsCallsOnly.length).toBe(0);
    });
  });
});
