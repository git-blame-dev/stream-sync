type NotificationGateConfig = Record<string, Record<string, unknown>>;

class NotificationGate {
    config: NotificationGateConfig;

    constructor(config: NotificationGateConfig, private readonly operatorPreparationEnabled = false) {
        this.config = config;
    }

    hasConfigAccess(): boolean {
        return !!this.config;
    }

    isEnabled(settingKey: string, platform: string): boolean {
        if (this.operatorPreparationEnabled) return true;
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
