import { normalizeTikTokHttpUrl } from '../../utils/tiktok-data-extraction';

type Payload = Record<string, unknown>;

function record(value: unknown): Payload {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {};
}

function image(value: unknown): Payload {
    const valueRecord = record(value);
    return { ...valueRecord, url: valueRecord.urlList ?? valueRecord.url };
}

function firstImageUrl(...candidates: unknown[]): string | undefined {
    for (const candidate of candidates) {
        const candidateRecord = record(candidate);
        const urls = candidateRecord.urlList ?? candidateRecord.url;
        if (Array.isArray(urls)) {
            const found = urls.map(normalizeTikTokHttpUrl).find(Boolean);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

function userAvatar(user: Payload): Payload {
    for (const candidate of [user.avatarLarge, user.avatarMedium, user.avatarThumb, user.avatarJpg, user.profilePicture]) {
        const candidateRecord = record(candidate);
        const urls = candidateRecord.urlList ?? candidateRecord.url;
        const validUrls = Array.isArray(urls) ? urls.map(normalizeTikTokHttpUrl).filter(Boolean) : [];
        if (validUrls.length > 0) {
            return { ...candidateRecord, url: validUrls };
        }
    }
    return image(user.avatarLarge ?? user.avatarMedium ?? user.avatarThumb ?? user.avatarJpg ?? user.profilePicture);
}

function adaptBadge(value: unknown): Payload {
    const badge = record(value);
    const combine = record(badge.combine);
    const badgeImage = record(badge.image);
    const text = record(badge.text);
    const combineText = record(combine.text);
    const label = (typeof text.defaultPattern === 'string' && text.defaultPattern.trim())
        || (typeof combineText.defaultPattern === 'string' && combineText.defaultPattern.trim())
        || (typeof combine.str === 'string' && combine.str.trim())
        || '';
    return {
        ...badge,
        ...(label ? { text: { ...text, defaultPattern: label } } : {}),
        combine: { ...combine, icon: image(combine.icon ?? badgeImage.image) },
    };
}

function resolveEventUser(data: Payload, common: Payload): Payload | null {
    if (data.user && typeof data.user === 'object' && !Array.isArray(data.user)) {
        return data.user as Payload;
    }
    const pieces = [
        ...(Array.isArray(record(common.displayText).pieces) ? record(common.displayText).pieces as unknown[] : []),
        ...(Array.isArray(record(data.commonBarrageContent).pieces) ? record(data.commonBarrageContent).pieces as unknown[] : []),
    ];
    for (const piece of pieces) {
        const pieceUser = record(record(piece).userValue).user;
        if (pieceUser && typeof pieceUser === 'object' && !Array.isArray(pieceUser)) {
            return pieceUser as Payload;
        }
    }
    return null;
}

/** Translate the connector's v3 payloads at the platform boundary. */
function adaptTikTokEvent(type: string, value: unknown): Payload {
    const data = record(value);
    const common = record(data.common);
    const rawUser = resolveEventUser(data, common);
    const user = record(rawUser);
    const identity = record(data.userIdentity);
    const gift = record(data.gift);
    const badgeList = Array.isArray(user.badgeList) ? user.badgeList : [];
    const adaptedUserFields: Payload = {
        userId: user.idStr || user.id,
        uniqueId: user.displayId,
        nickname: user.nickname,
        profilePicture: userAvatar(user),
        followRole: record(user.followInfo).followStatus,
        userBadges: badgeList,
        badgeImageList: (Array.isArray(user.badgeImageList) ? user.badgeImageList : []).map(image),
        badges: badgeList.map(adaptBadge),
    };
    const adapted: Payload = {
        msgId: common.msgId,
        isModerator: identity.isModeratorOfAnchor === true,
        isOwner: identity.isAnchor === true,
        ...(rawUser ? { user: Object.assign({ ...adaptedUserFields }, user, adaptedUserFields) } : {}),
    };
    if (type === 'chat') {
        adapted.comment = data.content;
        const emotes = Array.isArray(data.emoteList)
            ? data.emoteList.map((emote, index) => ({ index, emote }))
            : (Array.isArray(data.emotes) ? data.emotes : []);
        adapted.emotes = emotes.map(value => {
            const entry = record(value);
            const emote = record(entry.emote);
            return { placeInComment: entry.index, emote: {
                emoteId: emote.emoteId,
                image: { imageUrl: firstImageUrl(emote.image) },
            } };
        });
    } else if (type === 'gift') {
        const rawGiftDetails = record(data.giftDetails);
        adapted.giftDetails = data.gift ? { ...gift, giftName: gift.name, giftType: gift.type } : undefined;
        const giftPictureUrl = firstImageUrl(gift.image, gift.icon, rawGiftDetails.giftImage);
        adapted.gift = { ...gift, giftPictureUrl };
    } else if (type === 'envelope' && data.envelopeInfo) {
        const envelope = record(data.envelopeInfo);
        const metadata: Payload = {};
        for (const [source, target] of [['sendUserName', 'senderName'], ['sendUserId', 'senderId'], ['envelopeId', 'envelopeId']] as const) {
            const value = envelope[source];
            if (typeof value === 'string' && value.trim()) metadata[target] = value.trim();
        }
        for (const field of ['businessType', 'diamondCount', 'peopleCount', 'superFanCount']) {
            const value = envelope[field];
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) metadata[field] = value;
        }
        // Match the installed connector's box classification without forwarding its second alias.
        const displayKey = record(common.displayText).key;
        metadata.isSuperFanBox = envelope.businessType === 19 ||
            (typeof displayKey === 'string' && displayKey.toLowerCase().includes('ttlive_superfanbox'));
        const avatarUrl = firstImageUrl(envelope.sendUserAvatar);
        if (avatarUrl) adapted.avatarUrl = avatarUrl;
        adapted.metadata = { envelope: metadata };
    } else if (type === 'subscribe') {
        const months = Number(data.subMonth);
        if (Number.isSafeInteger(months) && months > 0) adapted.months = months;
    } else if (type === 'roomUser') {
        const count = typeof data.total === 'number' || (typeof data.total === 'string' && /^\d+$/.test(data.total))
            ? Number(data.total) : NaN;
        adapted.viewerCount = Number.isSafeInteger(count) && count >= 0 ? count : undefined;
    }
    return Object.assign({ ...adapted }, data, adapted);
}

export { adaptTikTokEvent };
