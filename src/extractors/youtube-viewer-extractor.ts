export type ViewerCountSource = 'original_view_count' | 'unlabeled_view_count_value' | 'view_text';
export type ViewerExtractionResult = {
    success: boolean;
    count: number;
    strategy: ViewerCountSource | null;
    metadata: { source: ViewerCountSource | null };
};

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

function exactTextCount(value: unknown): number | null {
    if (typeof value !== 'string' || value.trim() !== value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
    const count = Number(value.replace(/,/g, ''));
    return YouTubeViewerExtractor.isValidViewerCount(count) ? count : null;
}

function watchingTextCount(value: unknown): number | null {
    const match = typeof value === 'string'
        ? /^\s*((?:\d+|\d{1,3}(?:,\d{3})+))\s+(?:watching(?:\s+now)?|currently\s+watching|viewers?\s+watching|people\s+watching)\s*$/i.exec(value) : null;
    return exactTextCount(match?.[1]);
}

class YouTubeViewerExtractor {
    static extractConcurrentViewers(videoInfo: unknown): ViewerExtractionResult {
        const unavailable: ViewerExtractionResult = { success: false, count: 0, strategy: null, metadata: { source: null } };
        const info = record(videoInfo);
        const basic = record(info?.basic_info);
        const views = record(record(info?.primary_info)?.view_count);
        // The primary renderer identifies concurrent viewers. Basic view_count is cumulative.
        if (views?.is_live !== true || basic?.is_live === false || basic?.is_upcoming === true ||
            basic?.is_live_content === false || basic?.is_post_live_dvr === true || basic?.end_timestamp != null ||
            (basic?.start_timestamp instanceof Date && basic.start_timestamp.getTime() > Date.now())) return unavailable;

        let count: number | null = null;
        let source: ViewerCountSource | null = null;
        if (views.original_view_count !== undefined) {
            if (!this.isValidViewerCount(views.original_view_count)) return unavailable;
            count = views.original_view_count;
            source = 'original_view_count';
        }
        if (views.unlabeled_view_count_value !== undefined) {
            const unlabeled = exactTextCount(record(views.unlabeled_view_count_value)?.text);
            if (unlabeled === null || (count !== null && count !== unlabeled)) return unavailable;
            if (count === null) {
                count = unlabeled;
                source = 'unlabeled_view_count_value';
            }
        }
        const watching = watchingTextCount(record(views.view_count)?.text);
        if (count !== null && watching !== null && count !== watching) return unavailable;
        if (count === null) {
            count = watching;
            source = count === null ? null : 'view_text';
        }
        return count === null ? unavailable : { success: true, count, strategy: source, metadata: { source } };
    }

    static isValidViewerCount(count: unknown): count is number {
        return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
    }
}

export { YouTubeViewerExtractor };
