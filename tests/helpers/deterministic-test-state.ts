import { resetMockFactorySequence } from './mock-factories';
import { resetPlatformTestDataSequence } from './platform-test-data';
import { resetTestIds } from './test-id';
import { resetTestSetupSequence } from './test-setup';
import { resetTikTokTestDataSequence } from './tiktok-test-data';
import { resetTwitchTestDataSequence } from './twitch-test-data';
import { resetYouTubeTestDataSequence } from './youtube-test-data';

const resetDeterministicTestState = () => {
    resetTestIds();
    resetTestSetupSequence();
    resetYouTubeTestDataSequence();
    resetTwitchTestDataSequence();
    resetTikTokTestDataSequence();
    resetPlatformTestDataSequence();
    resetMockFactorySequence();
};

export {
    resetDeterministicTestState
};
