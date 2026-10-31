import type { AppLogger } from '../../core/logger/types';

type DiagnosticLogger = Pick<AppLogger, 'debug' | 'warn'>;
type BatchMessage = { method: string; decodedData?: unknown; decodeError?: unknown };
const REPORT_INTERVAL_MS = 60_000;

/** Fixed-size, content-free counters for one SDK connection attempt. */
class TikTokTransportDiagnostics {
    private readonly startedAt: number;
    private lastSummaryAt: number;
    private lastFailureAt = -Infinity;
    private closed = false;
    private readonly counts = {
        batches: 0,
        messages: 0,
        decodedMessages: 0,
        chatMessages: 0,
        emoteMessages: 0,
        decodeFailures: 0,
        chatDecodeFailures: 0,
        emoteDecodeFailures: 0,
        undecodedWithoutError: 0,
    };

    constructor(private readonly logger: DiagnosticLogger, private readonly now = () => performance.now()) {
        this.startedAt = this.now();
        this.lastSummaryAt = this.startedAt;
    }

    record(messages: readonly BatchMessage[]): void {
        if (this.closed) return;
        this.counts.batches++;
        let failed = false;
        for (const message of messages) {
            this.counts.messages++;
            if (message.method === 'WebcastChatMessage') this.counts.chatMessages++;
            if (message.method === 'WebcastEmoteChatMessage') this.counts.emoteMessages++;
            if (message.decodedData) this.counts.decodedMessages++;
            else if (message.decodeError) {
                failed = true;
                this.counts.decodeFailures++;
                if (message.method === 'WebcastChatMessage') this.counts.chatDecodeFailures++;
                if (message.method === 'WebcastEmoteChatMessage') this.counts.emoteDecodeFailures++;
            } else this.counts.undecodedWithoutError++;
        }
        const now = this.now();
        if (failed && now - this.lastFailureAt >= REPORT_INTERVAL_MS) {
            this.lastFailureAt = now;
            this.report('decode-failure', now);
        } else if (now - this.lastSummaryAt >= REPORT_INTERVAL_MS) this.report('periodic', now);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.report('closed', this.now());
    }

    private report(stage: 'decode-failure' | 'periodic' | 'closed', now: number): void {
        this.lastSummaryAt = now;
        const summary = { stage, elapsedMs: Math.max(0, Math.round(now - this.startedAt)), ...this.counts };
        try {
            if (stage === 'decode-failure') this.logger.warn('TikTok transport decode failure summary', 'tiktok', summary);
            else this.logger.debug('TikTok transport summary', 'tiktok', summary);
        } catch { /* Diagnostic sink failures must not interrupt chat delivery or cancellation. */ }
    }
}

export { TikTokTransportDiagnostics, type DiagnosticLogger };
