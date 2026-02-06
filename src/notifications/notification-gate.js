class NotificationGate {
    constructor(config) {
        this.config = config;
    }

    hasConfigAccess() {
        return !!this.config;
    }

    isEnabled(settingKey, platform) {
        const value = this.config?.[platform]?.[settingKey];
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.${settingKey}`);
        }
        return !!value;
    }
}

module.exports = {
    NotificationGate
};
