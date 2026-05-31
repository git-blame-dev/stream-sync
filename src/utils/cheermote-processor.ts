type CheermoteFragment = {
    type?: string;
    text?: string;
    cheermote?: {
        prefix?: string;
        bits?: unknown;
    };
};

type CheermoteTypeStats = Record<string, { count: number; bits: number }>;

class CheermoteProcessor {
    static processEventSubFragments(fragments: unknown) {
        if (!fragments || !Array.isArray(fragments) || fragments.length === 0) {
            return this.createEmptyResult();
        }

        const typedFragments = fragments as CheermoteFragment[];
        const cheermoteFragments = typedFragments.filter(frag => frag.type === 'cheermote');
        const textFragments = typedFragments.filter(frag => frag.type === 'text');

        if (cheermoteFragments.length === 0) {
            return this.createEmptyResult();
        }

        const textContent = textFragments.map(frag => frag.text || '').join('');

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

    static analyzeCheermoteTypes(cheermoteFragments: CheermoteFragment[]) {
        const typeStats: CheermoteTypeStats = {};
        let totalBits = 0;

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

        const primaryType = this.findPrimaryType(typeStats);
        if (!primaryType) {
            return this.createEmptyResult();
        }
        const mixedTypes = typeNames.length > 1;
        const otherTypesCount = Math.max(0, typeNames.length - 1);

        return {
            totalBits,
            primaryType: primaryType.toLowerCase(),
            cleanPrimaryType: primaryType.toLowerCase(),
            cleanPrimaryTypeOriginalCase: primaryType,
            mixedTypes,
            otherTypesCount,
            types: typeNames.map(type => ({
                prefix: type,
                count: typeStats[type]?.count ?? 0,
                totalBits: typeStats[type]?.bits ?? 0
            }))
        };
    }

    static extractCleanPrefix(prefix: unknown): string {
        if (!prefix || typeof prefix !== 'string') {
            return '';
        }

        return prefix.replace(/\d+$/, '');
    }

    static findPrimaryType(typeStats: CheermoteTypeStats): string | null {
        const entries = Object.entries(typeStats);
        
        if (entries.length === 0) {
            return null;
        }

        entries.sort((a, b) => {
            if (b[1].bits !== a[1].bits) {
                return b[1].bits - a[1].bits;
            }
            if (b[1].count !== a[1].count) {
                return b[1].count - a[1].count;
            }
            return a[0].localeCompare(b[0]);
        });

        return entries[0]?.[0] ?? null;
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

export { CheermoteProcessor };
