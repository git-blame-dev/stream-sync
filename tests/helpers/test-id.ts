import { now } from './test-clock';

let counter = 0;

const nextTestId = (prefix = 'id') => {
    counter += 1;
    return `${prefix}-${now()}-${counter}`;
};

const resetTestIds = () => {
    counter = 0;
};

export {
    nextTestId,
    resetTestIds
};
