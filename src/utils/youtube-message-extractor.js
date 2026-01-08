
function extractMessageText(messageObject) {
    if (!messageObject || typeof messageObject !== 'object') {
        return '';
    }

    if (typeof messageObject.text === 'string' && messageObject.text.trim()) {
        return messageObject.text;
    }

    if (messageObject.runs && Array.isArray(messageObject.runs)) {
        return messageObject.runs
            .map(run => run.text || '')
            .join('');
    }

    return '';
}

function shouldSuppressYouTubeNotification(author) {
    if (!author || typeof author !== 'object') {
        return true;
    }
    const username = typeof author.name === 'string' ? author.name.trim() : '';
    return username.length === 0;
}

const YouTubeMessageExtractor = {
    extractMessage(chatItem) {
        if (!chatItem || typeof chatItem !== 'object') {
            return '';
        }
        const messageField = chatItem.item?.message || chatItem.message || '';
        return extractMessageText(messageField);
    }
};

module.exports = {
    extractMessageText,
    YouTubeMessageExtractor,
    shouldSuppressYouTubeNotification
};
