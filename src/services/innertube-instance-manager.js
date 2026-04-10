const manager = require('./innertube-instance-manager.ts');

module.exports = {
    InnertubeInstanceManager: manager.InnertubeInstanceManager,
    setInnertubeImporter: manager.setInnertubeImporter,
    getInstance: manager.getInstance,
    cleanup: manager.cleanup,
    _resetInstance: manager._resetInstance
};
