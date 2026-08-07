export type PlatformInitializationState = 'ready' | 'monitoring' | 'recovering';

export type PlatformInitializationOutcome =
    | { state: 'ready' }
    | { state: 'monitoring' }
    | { state: 'recovering'; error: unknown };
