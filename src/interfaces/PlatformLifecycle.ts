export type PlatformInitializationState = 'ready' | 'monitoring' | 'recovering';

/** The initialization attempt lost ownership; its caller must not retire the current session. */
export class PlatformInitializationSupersededError extends Error {
    constructor(options?: ErrorOptions) {
        super('Platform initialization superseded', options);
        this.name = 'PlatformInitializationSupersededError';
    }
}

export type PlatformInitializationOutcome =
    | { state: 'ready' }
    | { state: 'monitoring' }
    | { state: 'recovering'; error: unknown };
