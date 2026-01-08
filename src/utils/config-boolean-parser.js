
function parseConfigBoolean(value, defaultValue = false) {
    // Handle undefined or null
    if (value === undefined || value === null) {
        return defaultValue;
    }
    
    // Handle actual booleans
    if (typeof value === 'boolean') {
        return value;
    }
    
    // Handle string booleans
    if (typeof value === 'string') {
        const lowercaseValue = value.toLowerCase().trim();
        
        // Explicitly true values (only accept 'true' for strict parsing)
        if (lowercaseValue === 'true') {
            return true;
        }
        
        // Explicitly false values
        if (lowercaseValue === 'false' || lowercaseValue === '0' || lowercaseValue === 'no' || lowercaseValue === '') {
            return false;
        }
    }
    
    // For any other value type or unrecognized string, use default
    return defaultValue;
}

function parseConfigBooleanDefaultTrue(value) {
    return parseConfigBoolean(value, true);
}

module.exports = {
    parseConfigBoolean,
    parseConfigBooleanDefaultTrue
};