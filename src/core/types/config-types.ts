export type ConfigScalarType = 'string' | 'number' | 'boolean' | 'stringArray';

export type ConfigScalarValue = string | number | boolean | readonly string[] | null;

export interface ConfigFieldSpec {
    type: ConfigScalarType;
    default?: unknown;
    requiredWhenEnabled?: boolean;
    userDefined?: boolean;
    inheritFrom?: 'general';
    enum?: readonly string[];
    min?: number;
    max?: number;
    integer?: boolean;
}

export type ConfigSectionSpec = Record<string, ConfigFieldSpec | boolean | undefined> & {
    _dynamic?: boolean;
};

export type ConfigSchema = Record<string, ConfigSectionSpec>;

export type ConfigSectionName =
    | 'general'
    | 'http'
    | 'youtube'
    | 'twitch'
    | 'tiktok'
    | 'streamelements'
    | 'spam'
    | 'displayQueue'
    | 'gui'
    | 'logging'
    | 'timing'
    | 'handcam'
    | 'cooldowns'
    | 'obs'
    | 'goals'
    | 'gifts'
    | 'envelopes'
    | 'farewell'
    | 'commands'
    | 'shares'
    | 'vfx'
    | 'follows'
    | 'raids'
    | 'paypiggies'
    | 'greetings';

export type RawConfigSection = Record<string, unknown>;

export type RawConfig = Partial<Record<ConfigSectionName, RawConfigSection>> & Record<string, RawConfigSection | undefined>;

export type ConfigDefaultsSection = Record<string, ConfigScalarValue>;

export type ConfigDefaultSectionName = Exclude<ConfigSectionName, 'commands'>;

export type ConfigDefaults = Record<ConfigDefaultSectionName, ConfigDefaultsSection> & {
    LOG_DIRECTORY: string;
};

export type NormalizedConfigSection = Record<string, unknown>;

export type NormalizedConfig = Record<ConfigSectionName, NormalizedConfigSection>;

export interface ParseNumberOptions {
    defaultValue?: unknown;
    min?: number;
    max?: number;
    allowZero?: boolean;
    requireInteger?: boolean;
}

export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
}

export type BuiltConfig = Record<string, unknown>;
