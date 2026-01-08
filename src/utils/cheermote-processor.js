

class CheermoteProcessor {
    static processEventSubFragments(fragments) {
        if (!fragments || !Array.isArray(fragments) || fragments.length === 0) {
            return this.createEmptyResult();
        }

        // Extract cheermote fragments
        const cheermoteFragments = fragments.filter(frag => frag.type === 'cheermote');
        const textFragments = fragments.filter(frag => frag.type === 'text');

        if (cheermoteFragments.length === 0) {
            return this.createEmptyResult();
        }

        // Extract text content without cheermotes (preserve leading/trailing spaces)
        const textContent = textFragments.map(frag => frag.text || '').join('');

        // Analyze cheermote types
        const analysis = this.analyzeCheermoteTypes(cheermoteFragments);

        return {
            totalBits: analysis.totalBits,
            primaryType: analysis.primaryType,
            cleanPrimaryType: analysis.cleanPrimaryType,
            textContent: textContent,
            mixedTypes: analysis.mixedTypes,
            otherTypesCount: analysis.otherTypesCount,
            types: analysis.types,
            fragments: cheermoteFragments
        };
    }

    static analyzeCheermoteTypes(cheermoteFragments) {
        const typeCounts = {};
        let totalBits = 0;

        // Count each type and accumulate bits
        for (const fragment of cheermoteFragments) {
            if (fragment.cheermote && fragment.cheermote.prefix) {
                const cleanPrefix = this.extractCleanPrefix(fragment.cheermote.prefix);
                typeCounts[cleanPrefix] = (typeCounts[cleanPrefix] || 0) + 1;
                totalBits += fragment.cheermote.bits || 0;
            }
        }

        const typeNames = Object.keys(typeCounts);
        
        if (typeNames.length === 0) {
            return {
                totalBits: 0,
                primaryType: null,
                cleanPrimaryType: null,
                mixedTypes: false,
                otherTypesCount: 0,
                types: []
            };
        }

        // Find primary type (most common, or first if tied)
        const primaryType = this.findPrimaryType(typeCounts);
        const mixedTypes = typeNames.length > 1;
        const otherTypesCount = Math.max(0, typeNames.length - 1);

        return {
            totalBits,
            primaryType: primaryType.toLowerCase(),
            cleanPrimaryType: primaryType.toLowerCase(), // Lowercase for processor consistency
            cleanPrimaryTypeOriginalCase: primaryType, // Original case for display  
            mixedTypes,
            otherTypesCount,
            types: typeNames.map(type => ({
                prefix: type,
                count: typeCounts[type]
            }))
        };
    }

    static extractCleanPrefix(prefix) {
        if (!prefix || typeof prefix !== 'string') {
            return '';
        }

        // Remove trailing numbers while preserving the base name and case
        return prefix.replace(/\d+$/, '');
    }

    static findPrimaryType(typeCounts) {
        const entries = Object.entries(typeCounts);
        
        if (entries.length === 0) {
            return null;
        }

        // Sort by count (descending), then alphabetically for consistency
        entries.sort((a, b) => {
            if (b[1] !== a[1]) {
                return b[1] - a[1]; // Higher count first
            }
            return a[0].localeCompare(b[0]); // Alphabetical for ties
        });

        return entries[0][0];
    }

    static createEmptyResult() {
        return {
            totalBits: 0,
            primaryType: null,
            cleanPrimaryType: null,
            textContent: '',
            mixedTypes: false,
            otherTypesCount: 0,
            types: []
        };
    }
}

module.exports = {
    CheermoteProcessor
};
