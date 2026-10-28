import { asRecord, isRecord } from '../../utils/record-contracts';
import { normalizeYouTubeUsername } from './youtube-username-normalizer';

interface ExtractedAuthor {
  id: string;
  name: string;
  thumbnailUrl: string;
  badges: unknown[];
  isModerator: boolean;
  isVerified: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractAuthor(chatItem: unknown): ExtractedAuthor | null {
  const chatRecord = asRecord(chatItem);
  if (!chatRecord) {
    return null;
  }

  const item = asRecord(chatRecord.item);
  if (!item) {
    return null;
  }

  const author = asRecord(item.author);
  if (!author) {
    return null;
  }

  const id = author.id;
  const rawName = author.name;
  if (!isNonEmptyString(id) || !isNonEmptyString(rawName)) {
    return null;
  }

  const name = normalizeYouTubeUsername(rawName);
  if (!name) {
    return null;
  }
  const thumbnailUrl = extractThumbnailUrl(author.thumbnails);
  const badges = Array.isArray(author.badges) ? author.badges.filter(isRecord) : [];
  const isModerator = author.is_moderator === true;
  const isVerified = author.is_verified === true;

  return {
    id: id.trim(),
    name,
    thumbnailUrl,
    badges,
    isModerator,
    isVerified
  };
}

function extractThumbnailUrl(thumbnails: unknown): string {
  if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
    return '';
  }
  for (const thumbnail of thumbnails) {
    const record = asRecord(thumbnail);
    if (isNonEmptyString(record?.url)) {
      return record.url.trim();
    }
  }
  return '';
}

export { extractAuthor };
