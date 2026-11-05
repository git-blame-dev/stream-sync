import { NOTIFICATION_CONFIGS } from './constants';
import { OPERATOR_CONTROL_KEYS, type OperatorConfigState, type OperatorControlKey } from './operator-control-contract';

type ViewerOutputConfig = { general?: Record<string, unknown>; tiktok?: Record<string, unknown>; twitch?: Record<string, unknown>; youtube?: Record<string, unknown> };

// Capture resolved per-platform settings once; event paths only do bounded lookups.
export class ViewerOutputPolicy {
    private readonly baseline: ReadonlyMap<string, Partial<Record<OperatorControlKey, boolean>>>;
    readonly configStates: Readonly<Partial<Record<OperatorControlKey, OperatorConfigState>>>;

    constructor(config: ViewerOutputConfig, private readonly override: (key: OperatorControlKey) => boolean | undefined) {
        const baseline = new Map<string, Partial<Record<OperatorControlKey, boolean>>>();
        for (const platform of ['tiktok', 'twitch', 'youtube'] as const) {
            const values: Partial<Record<OperatorControlKey, boolean>> = {};
            for (const key of OPERATOR_CONTROL_KEYS) {
                const value = config[platform]?.[key];
                if (typeof value === 'boolean') values[key] = value;
            }
            baseline.set(platform, values);
        }
        this.baseline = baseline;
        this.configStates = Object.freeze(Object.fromEntries(OPERATOR_CONTROL_KEYS.map(key => {
            const values = [...baseline.values()].map(settings => settings[key]).filter(value => value !== undefined);
            return [key, values.length ? values.every(Boolean) ? 'on' : values.some(Boolean) ? 'mixed' : 'off' : config.general?.[key] === false ? 'off' : 'on'];
        })));
    }

    isEnabled(type: string, platform: string): boolean {
        const key = type === 'chat' ? 'messagesEnabled' : NOTIFICATION_CONFIGS[type as keyof typeof NOTIFICATION_CONFIGS]?.settingKey;
        if (!key) return true;
        const baseline = this.baseline.get(platform.toLowerCase())?.[key];
        // Absent fields represent unsupported platform categories.
        if (baseline === undefined) return false;
        return this.override(key) ?? baseline;
    }
}
