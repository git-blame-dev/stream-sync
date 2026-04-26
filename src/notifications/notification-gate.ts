type NotificationGateConfig = Record<string, Record<string, unknown>>;

class NotificationGate {
    config: NotificationGateConfig;

    constructor(config: NotificationGateConfig) {
        this.config = config;
    }

    hasConfigAccess(): boolean {
        return !!this.config;
    }

    isEnabled(settingKey: string, platform: string): boolean {
        const value = this.config[platform]?.[settingKey];
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.${settingKey}`);
        }

        return !!value;
    }
}

export {
    NotificationGate
};
