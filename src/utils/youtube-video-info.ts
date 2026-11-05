import { asRecord } from './record-contracts';

// getInfo combines independent /player and /next responses. Both must identify
// the requested video before using chat or viewer data from /next.
export function hasMatchingYouTubeVideoInfo(videoId: string, info: unknown): boolean {
    if (!videoId) return false;
    const record = asRecord(info);
    const basic = asRecord(record?.basic_info);
    const next = Array.isArray(record?.page) ? asRecord(record.page[1]) : undefined;
    const endpoint = asRecord(next?.current_video_endpoint);
    return basic?.id === videoId && asRecord(endpoint?.payload)?.videoId === videoId;
}
