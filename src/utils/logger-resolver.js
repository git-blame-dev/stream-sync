const { validateLoggerInterface } = require('./dependency-validator');

function _normalizeLoggerMethods(logger) {
    const required = ['debug', 'info', 'warn', 'error', 'console'];
    const normalized = Object.assign(Object.create(Object.getPrototypeOf(logger)), logger);
    required.forEach((method) => {
        if (typeof normalized[method] !== 'function') {
            normalized[method] = () => {};
        }
    });
    return normalized;
}

function _gatherCandidates(candidate) {
    const candidates = [];

    if (candidate) {
        candidates.push(candidate);
    }

    try {
        const logging = require('../core/logging');
        if (logging) {
            if (typeof logging.getUnifiedLogger === 'function') {
                const unified = logging.getUnifiedLogger();
                if (unified) {
                    candidates.push(unified);
                }
            }
            if (logging.logger) {
                candidates.push(logging.logger);
            }
        }
    } catch { }

    return candidates;
}

function resolveLogger(candidate = null, moduleName = 'logger') {
    const candidates = _gatherCandidates(candidate);
    const selected = candidates.find(Boolean);
    if (!selected) {
        throw new Error(`${moduleName} requires a logger dependency`);
    }

    const normalized = _normalizeLoggerMethods(selected);
    validateLoggerInterface(normalized);
    return normalized;
}

module.exports = {
    resolveLogger
};
