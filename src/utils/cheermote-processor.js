

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
        const typeStats = {};
        let totalBits = 0;

        // Count each type and accumulate bits
        for (const fragment of cheermoteFragments) {
            if (fragment.cheermote && fragment.cheermote.prefix) {
                const cleanPrefix = this.extractCleanPrefix(fragment.cheermote.prefix);
                const fragmentBits = Number(fragment.cheermote.bits) || 0;
                if (!typeStats[cleanPrefix]) {
                    typeStats[cleanPrefix] = { count: 0, bits: 0 };
                }
                typeStats[cleanPrefix].count += 1;
                typeStats[cleanPrefix].bits += fragmentBits;
                totalBits += fragmentBits;
            }
        }

        const typeNames = Object.keys(typeStats);
        
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
        const primaryType = this.findPrimaryType(typeStats);
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
                count: typeStats[type].count,
                totalBits: typeStats[type].bits
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

    static findPrimaryType(typeStats) {
        const entries = Object.entries(typeStats);
        
        if (entries.length === 0) {
            return null;
        }

        // Sort by total bits (descending), then count, then alphabetically for ties
        entries.sort((a, b) => {
            if (b[1].bits !== a[1].bits) {
                return b[1].bits - a[1].bits;
            }
            if (b[1].count !== a[1].count) {
                return b[1].count - a[1].count;
            }
            return a[0].localeCompare(b[0]);
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
