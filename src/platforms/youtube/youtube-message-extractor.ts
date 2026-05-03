type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as UnknownRecord;
}

function extractMessageText(messageObject: unknown): string {
  const typedMessageObject = asRecord(messageObject);
  if (!typedMessageObject) {
    return '';
  }

  if (typeof typedMessageObject.text === 'string' && typedMessageObject.text.trim()) {
    return typedMessageObject.text;
  }

  if (typedMessageObject.runs && Array.isArray(typedMessageObject.runs)) {
    return typedMessageObject.runs
      .map((run) => {
        const typedRun = asRecord(run);
        if (!typedRun) {
          return '';
        }

        const text = typedRun.text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }

  return '';
}

export { extractMessageText };
