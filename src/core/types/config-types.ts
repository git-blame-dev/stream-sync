export type ConfigScalarType = 'string' | 'number' | 'boolean' | 'stringArray';

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

export type NormalizedConfig = Record<string, Record<string, unknown>>;

export type BuiltConfig = Record<string, unknown>;
