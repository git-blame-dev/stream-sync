
function isIsoTimestamp(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
    if (!isoPattern.test(value)) {
        return false;
    }
    const parsed = Date.parse(value);
    return !Number.isNaN(parsed);
}

function getSystemTimestampISO() {
    return new Date().toISOString();
}

module.exports = {
    isIsoTimestamp,
    getSystemTimestampISO
};
