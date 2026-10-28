import { DISPLAY_EVENT_TYPES, type DisplayLifecyclePayload } from '../interfaces/DisplayEvents';
import { safeSetTimeout } from '../utils/timeout-validator';

export type NotificationDisplayCoordinatorOptions = {
    notificationIdleHoldMs?: number;
    monetizationIdleHoldMs?: number;
    notificationTransitionMs?: number;
    effectFallbackMs?: number;
    delay?: (ms: number) => Promise<void>;
    emit?: (event: string, payload: DisplayLifecyclePayload) => void;
};

export type NotificationDisplayRegistration = {
    run: (onStart: () => void, effect: () => Promise<unknown> | unknown, cancelEffect?: () => void) => Promise<void>;
};

type CancellableDelay = {
    promise: Promise<void>;
    cancel: () => void;
};

const MONETIZATION_TYPES = new Set(['platform:gift', 'platform:paypiggy', 'platform:giftpaypiggy', 'platform:envelope']);
const DEFAULTS = { notificationIdleHoldMs: 5000, monetizationIdleHoldMs: 30000, notificationTransitionMs: 1000, effectFallbackMs: 60000 };

export class NotificationDisplayCoordinator {
    private stopped = false;
    private pendingCount = 0;
    private successorAvailable = false;
    private pendingVersion = 0;
    private readonly pendingWaiters = new Set<() => void>();
    private readonly stopWaiters = new Set<() => void>();
    private readonly options: Required<Pick<NotificationDisplayCoordinatorOptions, 'notificationIdleHoldMs' | 'monetizationIdleHoldMs' | 'notificationTransitionMs' | 'effectFallbackMs'>> & Pick<NotificationDisplayCoordinatorOptions, 'delay' | 'emit'>;

    constructor(options: NotificationDisplayCoordinatorOptions = {}) {
        this.options = { ...DEFAULTS, ...options };
    }

    setSuccessorAvailable(available: boolean) {
        this.successorAvailable = available;
        if (available) this.wakePendingWaiters();
    }

    register(item: { eventId?: string; type: string; platform?: string }): NotificationDisplayRegistration {
        const eventId = item.eventId || `${Date.now()}-${Math.random()}`;
        this.pendingCount += 1;
        this.pendingVersion += 1;
        this.wakePendingWaiters();

        let claimed = false;
        return {
            run: async (onStart, effect, cancelEffect) => {
                if (claimed) {
                    throw new Error('Notification display registration can only run once');
                }
                claimed = true;
                this.pendingCount = Math.max(0, this.pendingCount - 1);
                if (this.stopped) return;

                const holdMs = MONETIZATION_TYPES.has(item.type)
                    ? this.options.monetizationIdleHoldMs
                    : this.options.notificationIdleHoldMs;
                const payload = (phase: DisplayLifecyclePayload['phase']): DisplayLifecyclePayload => ({
                    eventId,
                    phase,
                    type: item.type,
                    timestamp: Date.now(),
                    ...(item.platform ? { platform: item.platform } : {})
                });

                onStart();
                let effectError: unknown = null;
                try {
                    if (!this.stopped) this.options.emit?.(DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE, payload('started'));
                } catch (error) {
                    effectError = error;
                }

                const hold = this.createDelay(holdMs);
                this.stopWaiters.add(hold.cancel);
                try {
                    await this.runEffectWithFallback(effect, cancelEffect);
                } catch (error) {
                    effectError ??= error;
                }

                let holdFinished = false;
                void hold.promise.then(() => { holdFinished = true; });
                while (!this.stopped && !holdFinished && this.pendingCount === 0 && !this.successorAvailable) {
                    const pendingWait = this.createPendingWait(this.pendingVersion);
                    await this.withStop(Promise.race([hold.promise, pendingWait.promise]));
                    pendingWait.cancel();
                }
                hold.cancel();
                this.stopWaiters.delete(hold.cancel);

                if (!this.stopped) this.options.emit?.(DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE, payload('exit-started'));
                if (!this.stopped) {
                    const transition = this.createDelay(this.options.notificationTransitionMs);
                    await this.withStop(transition.promise);
                    transition.cancel();
                }
                if (effectError) throw effectError;
            }
        };
    }

    private createPendingWait(version: number): { promise: Promise<void>; cancel: () => void } {
        if (this.pendingCount > 0 || this.successorAvailable || this.pendingVersion !== version || this.stopped) {
            return { promise: Promise.resolve(), cancel: () => {} };
        }

        let wake = () => {};
        const promise = new Promise<void>((resolve) => {
            wake = () => {
                this.pendingWaiters.delete(wake);
                resolve();
            };
            this.pendingWaiters.add(wake);
        });
        return { promise, cancel: () => this.pendingWaiters.delete(wake) };
    }

    private createDelay(ms: number): CancellableDelay {
        if (this.stopped) return { promise: Promise.resolve(), cancel: () => {} };
        if (this.options.delay) {
            return { promise: this.options.delay(ms), cancel: () => {} };
        }
        if (ms <= 0) {
            return { promise: Promise.resolve(), cancel: () => {} };
        }

        let handle: ReturnType<typeof safeSetTimeout> | null = null;
        const promise = new Promise<void>((resolve) => {
            handle = safeSetTimeout(() => {
                handle = null;
                resolve();
            }, ms);
        });
        return {
            promise,
            cancel: () => {
                if (handle === null) return;
                clearTimeout(handle);
                handle = null;
            }
        };
    }

    private async runEffectWithFallback(effect: () => Promise<unknown> | unknown, cancelEffect = () => {}) {
        let cancelled = false;
        const cancel = () => {
            if (cancelled) return;
            cancelled = true;
            clearTimeout(timeout);
            cancelEffect();
        };
        const timeout = safeSetTimeout(cancel, this.options.effectFallbackMs);
        this.stopWaiters.add(cancel);
        if (this.stopped) cancel();
        try { await effect(); }
        finally {
            clearTimeout(timeout);
            this.stopWaiters.delete(cancel);
        }
    }

    private withStop(operation: Promise<unknown>): Promise<void> {
        if (this.stopped) return Promise.resolve();
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (complete: () => void) => {
                if (settled) return;
                settled = true;
                this.stopWaiters.delete(stop);
                complete();
            };
            const stop = () => settle(resolve);
            this.stopWaiters.add(stop);
            operation.then(
                () => settle(resolve),
                (error) => settle(() => reject(error))
            );
        });
    }

    private wakePendingWaiters() {
        for (const wake of Array.from(this.pendingWaiters)) {
            wake();
        }
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        for (const stop of Array.from(this.stopWaiters)) stop();
        this.wakePendingWaiters();
    }
}
