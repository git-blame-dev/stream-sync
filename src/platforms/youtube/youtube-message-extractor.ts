function extractMessageText(messageObject: unknown): string {
    if (!messageObject || typeof messageObject !== 'object') {
        return '';
    }

    const typedMessageObject = messageObject as {
        text?: unknown;
        runs?: unknown;
    };

    if (typeof typedMessageObject.text === 'string' && typedMessageObject.text.trim()) {
        return typedMessageObject.text;
    }

    if (typedMessageObject.runs && Array.isArray(typedMessageObject.runs)) {
        return typedMessageObject.runs
            .map((run) => {
                if (!run || typeof run !== 'object') {
                    return '';
                }

                const text = (run as { text?: unknown }).text;
                return typeof text === 'string' ? text : '';
            })
            .join('');
    }

    return '';
}

export { extractMessageText };
