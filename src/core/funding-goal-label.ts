const MAX_FUNDING_GOAL_LABEL_CODE_POINTS = 80;

function validateFundingGoalLabel(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('Funding goal label must be a string');
    const label = value.trim();
    if (!label) throw new RangeError('Funding goal label must not be empty');
    if (/\p{Cc}/u.test(label)) throw new RangeError('Funding goal label must not contain control characters');
    if ([...label].some(character => /\p{Cf}/u.test(character) && character !== '\u200C' && character !== '\u200D')) {
        throw new RangeError('Funding goal label must not contain unsupported format characters');
    }
    if ([...label].length > MAX_FUNDING_GOAL_LABEL_CODE_POINTS) {
        throw new RangeError(`Funding goal label must be at most ${MAX_FUNDING_GOAL_LABEL_CODE_POINTS} Unicode code points`);
    }
    return label;
}

export { MAX_FUNDING_GOAL_LABEL_CODE_POINTS, validateFundingGoalLabel };
