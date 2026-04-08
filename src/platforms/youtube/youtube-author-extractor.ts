interface AuthorRecord {
    id?: unknown;
    name?: unknown;
    thumbnails?: unknown;
    badges?: unknown;
    is_moderator?: unknown;
    is_verified?: unknown;
}

interface ExtractedAuthor {
    id: unknown;
    name: string;
    thumbnailUrl: string;
    badges: unknown[];
    isModerator: boolean;
    isVerified: boolean;
}

function extractAuthor(chatItem: unknown): ExtractedAuthor | null {
    if (!chatItem || typeof chatItem !== 'object') {
        return null;
    }

    const item = (chatItem as { item?: unknown }).item;
    if (!item || typeof item !== 'object') {
        return null;
    }

    const author = (item as { author?: unknown }).author as AuthorRecord | undefined;
    if (!author || typeof author !== 'object') {
        return null;
    }

    const id = author.id;
    const rawName = author.name;
    if (!id || typeof rawName !== 'string' || !rawName.trim()) {
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
    const firstThumbnail = thumbnails[0] as { url?: unknown } | undefined;
    return typeof firstThumbnail?.url === 'string' ? firstThumbnail.url : '';
}

export { extractAuthor };
