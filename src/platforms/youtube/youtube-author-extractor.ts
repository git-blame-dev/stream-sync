type UnknownRecord = Record<string, unknown>;

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

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as UnknownRecord;
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

  const name = stripAtPrefix(rawName);
  const thumbnailUrl = extractThumbnailUrl(author.thumbnails);
  const badges = Array.isArray(author.badges) ? author.badges : [];
  const isModerator = author.is_moderator === true;
  const isVerified = author.is_verified === true;

  return {
    id,
    name,
    thumbnailUrl,
    badges,
    isModerator,
    isVerified
  };
}

function stripAtPrefix(name: string): string {
  if (name.startsWith('@')) {
    return name.slice(1);
  }
  return name;
}

function extractThumbnailUrl(thumbnails: unknown): string {
  if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
    return '';
  }
  const firstThumbnail = asRecord(thumbnails[0]);
  return typeof firstThumbnail?.url === 'string' ? firstThumbnail.url : '';
}

export { extractAuthor };
