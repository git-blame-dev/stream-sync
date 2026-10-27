type Payload = Record<string, unknown>;

function record(value: unknown): Payload {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : {};
}

function image(value: unknown): Payload {
    const valueRecord = record(value);
    return { ...valueRecord, url: valueRecord.urlList };
}

/** Translate the connector's v3 payloads at the platform boundary. */
function adaptTikTokEvent(type: string, value: unknown): Payload {
    const data = record(value);
    const user = record(data.user);
    const identity = record(data.userIdentity);
    const common = record(data.common);
    const gift = record(data.gift);
    const badgeList = Array.isArray(user.badgeList) ? user.badgeList : [];
    const result: Payload = {
        ...data,
        msgId: common.msgId,
        isModerator: identity.isModeratorOfAnchor === true,
        isOwner: identity.isAnchor === true,
        ...(data.user ? { user: {
            ...user,
            userId: user.idStr || user.id,
            uniqueId: user.displayId,
            profilePicture: image(user.avatarLarge),
            followRole: record(user.followInfo).followStatus,
            userBadges: badgeList,
            badgeImageList: (Array.isArray(user.badgeImageList) ? user.badgeImageList : []).map(image),
            badges: badgeList.map(value => {
                const badge = record(value);
                const combine = record(badge.combine);
                return { ...badge, combine: { ...combine, icon: image(combine.icon) } };
            }),
        } } : {}),
    };
    if (type === 'chat') {
        result.comment = data.content;
        result.emotes = (Array.isArray(data.emotes) ? data.emotes : []).map(value => {
            const entry = record(value);
            const emote = record(entry.emote);
            const urls = record(emote.image).urlList;
            return { placeInComment: entry.index, emote: {
                emoteId: emote.emoteId,
                image: { imageUrl: Array.isArray(urls) ? urls[0] : undefined },
            } };
        });
    } else if (type === 'gift') {
        result.giftDetails = data.gift ? { ...gift, giftName: gift.name, giftType: gift.type } : undefined;
        const urls = record(gift.image).urlList;
        result.gift = { ...gift, giftPictureUrl: Array.isArray(urls) ? urls[0] : undefined };
    } else if (type === 'subscribe') {
        const months = Number(data.subMonth);
        if (Number.isSafeInteger(months) && months > 0) result.months = months;
    } else if (type === 'roomUser') {
        const count = typeof data.total === 'number' || (typeof data.total === 'string' && /^\d+$/.test(data.total))
            ? Number(data.total) : NaN;
        result.viewerCount = Number.isSafeInteger(count) && count >= 0 ? count : undefined;
    }
    return result;
}

export { adaptTikTokEvent };
