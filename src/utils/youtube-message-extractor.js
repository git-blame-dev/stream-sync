
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

module.exports = {
    extractMessageText
};
