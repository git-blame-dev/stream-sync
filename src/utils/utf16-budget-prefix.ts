/** Return a UTF16-budgeted prefix without cutting a valid surrogate pair. */
export function utf16BudgetPrefix(text: string, budget: number): string {
    let end = Math.max(0, Math.min(text.length, Math.trunc(budget) || 0));
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) {
        end -= 1;
    }
    return text.slice(0, end);
}

/** Prefer complete words, falling back to a Unicode-safe prefix for a single long word. */
export function wordBudgetPrefix(text: string, budget: number): string {
    if (text.length <= budget) return text;
    let result = '';
    for (const word of text.split(/\s+/)) {
        const candidate = result ? `${result} ${word}` : word;
        if (candidate.length > budget) break;
        result = candidate;
    }
    return result || utf16BudgetPrefix(text, budget);
}
