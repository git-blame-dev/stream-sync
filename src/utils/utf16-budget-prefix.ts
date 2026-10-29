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
