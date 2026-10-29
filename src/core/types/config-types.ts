import type { CONFIG_SCHEMA } from '../config-schema';
import type { ConfigValidator } from '../../utils/config-validator';
import type { buildConfig } from '../config-builders';
import type { RowTheme, RowVisualEffectId } from '../row-presentation';

export type ConfigScalarType = 'string' | 'number' | 'boolean' | 'stringArray';
export type { RowTheme, RowVisualEffectId } from '../row-presentation';
export type MemberProfile = {
    id: string;
    identities: string[];
    greetingCommand: string;
    rowTheme?: RowTheme;
    rowEffects?: readonly RowVisualEffectId[];
    spriteUrl?: string;
};

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
    allowZero?: boolean;
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
    | 'handcam'
    | 'cooldowns'
    | 'obs'
    | 'goals'
    | 'fundingGoal'
    | 'monetizationValues'
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

export type ConfigDefaultsSection = Record<string, ConfigScalarValue | undefined>;

export type ConfigDefaultSectionName = Exclude<ConfigSectionName, 'commands'>;

export type ConfigDefaults = Record<ConfigDefaultSectionName, ConfigDefaultsSection> & {
    LOG_DIRECTORY: string;
};

export type NormalizedConfigSection = Record<string, unknown>;

type SchemaFieldValue<F> = F extends { userDefined: true } ? string | null
    : F extends { inheritFrom: string } ? boolean | null
    : F extends { type: 'boolean' } ? boolean
    : F extends { type: 'number' } ? number
    : F extends { type: 'stringArray' } ? readonly string[] | null
    : F extends { enum: readonly (infer E)[] } ? E : string;
export type NormalizedSchemaSection<S extends ConfigSectionName> = {
    -readonly [F in Exclude<keyof typeof CONFIG_SCHEMA[S], '_dynamic'>]: SchemaFieldValue<typeof CONFIG_SCHEMA[S][F]>
};
export type NormalizedConfig = ReturnType<typeof ConfigValidator.normalize>;

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

export type BuiltConfig = ReturnType<typeof buildConfig>;
