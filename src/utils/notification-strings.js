const { getCodeToSymbolMap } = require('./currency-utils');

function createPaypiggyTemplates() {
    return {
        display: `{username} {paypiggyAction}!`,
        displayWithTier: `{username} {paypiggyAction}! (Tier {tier})`,
        displayResub: `{username} {paypiggyResubAction} for {months} months!`,
        displayResubWithTier: `{username} {paypiggyResubAction} for {months} months! (Tier {tier})`,
        displayGift: `{username} gifted a {paypiggyNoun}!`,
        displayGiftWithTier: `{username} gifted a {paypiggyNoun}! (Tier {tier})`,
        tts: `{ttsUsername} {paypiggyActionTts}`,
        ttsResub: `{ttsUsername} {paypiggyResubActionTts} for {formattedMonths}`,
        ttsGift: `{ttsUsername} gifted a {paypiggyNoun}`,
        log: `New {paypiggyLogLabel}: {username}! (Tier: {tier})`,
        logResub: `{username} {paypiggyResubAction} for {months} months! (Tier: {tier})`,
        logGift: `{username} gifted a {paypiggyNoun}! (Tier: {tier})`
    };
}

const NOTIFICATION_TEMPLATES = {
    'platform:gift': {
        display: '{username} sent {formattedGiftCountForDisplay}',
        displayWithCoins: '{username} sent {formattedCoins} [{formattedGiftCountForDisplay}]',
        tts: '{ttsUsername} sent {formattedGiftCount}',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} with {formattedGiftCount}',
        log: 'Gift from {username}: {formattedGiftCount}'
    },

    'platform:follow': {
        display: '{username} just followed!',
        tts: '{ttsUsername} just followed',
        log: 'New follower: {username}'
    },

    'platform:paypiggy': createPaypiggyTemplates(),

    'platform:raid': {
        display: 'Incoming raid from {username} with {viewerCount} viewers!',
        tts: 'Incoming raid from {ttsUsername} with {formattedViewerCount}',
        log: 'Incoming raid from {username} with {viewerCount} viewers!'
    },

    'platform:envelope': {
        display: '{username} sent a treasure chest!',
        displayWithCoins: '{username} sent {formattedCoins} treasure chest!',
        tts: '{ttsUsername} sent a treasure chest',
        ttsWithCoins: '{ttsUsername} sent {formattedCoins} treasure chest',
        log: 'Treasure chest from {username}: {formattedCoins}'
    },

    greeting: {
        display: 'Welcome, {username}! \u{1F44B}',
        tts: 'Hi {ttsUsername}',
        log: 'Greeting: {username}'
    },

    farewell: {
        display: 'Goodbye, {username}! \u{1F44B}',
        tts: 'Goodbye {ttsUsername}',
        log: 'Farewell: {username}'
    },

    command: {
        display: '{username} used command {command}',
        tts: '{ttsUsername} used command {commandName}',
        log: 'Command {command} triggered by {username}'
    },
};

function formatCoins(coins) {
    if (coins === null || coins === undefined || isNaN(coins) || !isFinite(coins)) {
        return '0 coins';
    }

    const numericCoins = Math.max(0, Math.floor(Number(coins)));
    if (numericCoins === 0) return '0 coins';
    return numericCoins === 1 ? '1 coin' : `${numericCoins} coins`;
}

function formatSuperChatAmount(amount, currency = '$') {
    const validAmount = getValidNumber(amount);
    if (validAmount === null) {
        return `${getCurrencySymbol(currency)}0.00`;
    }
    if (validAmount === 0) {
        return `${getCurrencySymbol(currency)}0.00`;
    }

    if (shouldUseCurrencyCode(currency)) {
        return `${currency}${validAmount.toFixed(2)}`;
    }

    return `${getCurrencySymbol(currency)}${validAmount.toFixed(2)}`;
}

function shouldUseCurrencyCode(currency) {
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return false;

    const uniqueSymbolCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR'];
    if (uniqueSymbolCurrencies.includes(currency)) return false;

    return true;
}

function getCurrencySymbol(currencyCode) {
    if (!currencyCode) return '$';

    if (!/^[A-Z]{3}$/.test(currencyCode)) {
        return currencyCode;
    }

    const symbol = getCodeToSymbolMap().get(currencyCode);
    return symbol || currencyCode;
}

function formatCurrencyForTTS(amount, currency = '$') {
    const validAmount = getValidNumber(amount);
    if (validAmount === null) {
        return '0';
    }
    if (validAmount === 0) {
        return '0';
    }

    const currencyWord = getCurrencyWord(currency);
    const dollars = Math.floor(validAmount);
    const cents = Math.round((validAmount - dollars) * 100);

    if (cents === 0) {
        return dollars === 1 ? `1 ${getSingularCurrency(currencyWord)}` : `${dollars} ${currencyWord}`;
    } else {
        return `${dollars} ${currencyWord} ${cents}`;
    }
}

function getSingularCurrency(currencyWord) {
    const singularMap = {
        'dollars': 'dollar',
        'euros': 'euro',
        'pounds': 'pound',
        'yen': 'yen',
        'yuan': 'yuan',
        'rupees': 'rupee',
        'canadian dollars': 'canadian dollar',
        'australian dollars': 'australian dollar',
        'new zealand dollars': 'new zealand dollar',
        'swiss francs': 'swiss franc',
        'brazilian reais': 'brazilian real',
        'argentine pesos': 'argentine peso',
        'chilean pesos': 'chilean peso',
        'colombian pesos': 'colombian peso',
        'mexican pesos': 'mexican peso',
        'philippine pesos': 'philippine peso',
        'uruguayan pesos': 'uruguayan peso',
        'dominican pesos': 'dominican peso',
        'cuban pesos': 'cuban peso',
        'korean won': 'korean won'
    };

    return singularMap[currencyWord] || currencyWord.replace(/s$/, '');
}

function getCurrencyWord(currency) {
    const currencyMap = {
        '$': 'dollars',
        'USD': 'dollars',
        '\u20AC': 'euros',
        'EUR': 'euros',
        '\u00A3': 'pounds',
        'GBP': 'pounds',
        '\u00A5': 'yen',
        'JPY': 'yen',
        'CNY': 'yuan',
        '\u20B9': 'rupees',
        'INR': 'rupees',
        'CAD': 'canadian dollars',
        'AUD': 'australian dollars',
        'NZD': 'new zealand dollars',
        'CHF': 'swiss francs',
        'SEK': 'swedish krona',
        'NOK': 'norwegian kroner',
        'DKK': 'danish kroner',
        'PLN': 'polish zloty',
        'CZK': 'czech koruna',
        'HUF': 'hungarian forint',
        'RON': 'romanian leu',
        'BGN': 'bulgarian lev',
        'HRK': 'croatian kuna',
        'RSD': 'serbian dinar',
        'TRY': 'turkish lira',
        'ILS': 'israeli shekels',
        'AED': 'emirati dirhams',
        'SAR': 'saudi riyals',
        'QAR': 'qatari riyals',
        'KWD': 'kuwaiti dinars',
        'BHD': 'bahraini dinars',
        'OMR': 'omani rials',
        'EGP': 'egyptian pounds',
        'ZAR': 'south african rand',
        'NGN': 'nigerian naira',
        'KES': 'kenyan shillings',
        'GHS': 'ghanaian cedis',
        'UGX': 'ugandan shillings',
        'TZS': 'tanzanian shillings',
        'RWF': 'rwandan francs',
        'ETB': 'ethiopian birr',
        'MAD': 'moroccan dirhams',
        'TND': 'tunisian dinars',
        'DZD': 'algerian dinars',
        'LYD': 'libyan dinars',
        'XAF': 'central african francs',
        'XOF': 'west african francs',
        'BRL': 'brazilian reais',
        'ARS': 'argentine pesos',
        'CLP': 'chilean pesos',
        'COP': 'colombian pesos',
        'PEN': 'peruvian soles',
        'BOB': 'bolivian bolivianos',
        'UYU': 'uruguayan pesos',
        'PYG': 'paraguayan guaranis',
        'VES': 'venezuelan bolivars',
        'GYD': 'guyanese dollars',
        'SRD': 'surinamese dollars',
        'TTD': 'trinidad and tobago dollars',
        'JMD': 'jamaican dollars',
        'BBD': 'barbadian dollars',
        'BZD': 'belize dollars',
        'GTQ': 'guatemalan quetzals',
        'HNL': 'honduran lempiras',
        'NIO': 'nicaraguan cordobas',
        'CRC': 'costa rican colons',
        'PAB': 'panamanian balboas',
        'DOP': 'dominican pesos',
        'HTG': 'haitian gourdes',
        'CUP': 'cuban pesos',
        'MXN': 'mexican pesos',
        'KRW': 'korean won',
        '\u20A9': 'korean won',
        'TWD': 'taiwan dollars',
        'HKD': 'hong kong dollars',
        'SGD': 'singapore dollars',
        'MYR': 'malaysian ringgit',
        'THB': 'thai baht',
        'VND': 'vietnamese dong',
        'IDR': 'indonesian rupiah',
        'PHP': 'philippine pesos',
        'BND': 'brunei dollars',
        'KHR': 'cambodian riels',
        'LAK': 'lao kips',
        'MMK': 'myanmar kyats',
        'BDT': 'bangladeshi taka',
        'LKR': 'sri lankan rupees',
        'MVR': 'maldivian rufiyaa',
        'NPR': 'nepalese rupees',
        'BTN': 'bhutanese ngultrum',
        'PKR': 'pakistani rupees',
        'AFN': 'afghan afghanis',
        'UZS': 'uzbek som',
        'KZT': 'kazakhstani tenge',
        'KGS': 'kyrgyzstani som',
        'TJS': 'tajikistani somoni',
        'TMT': 'turkmen manat',
        'MNT': 'mongolian tugriks',
        'RUB': 'russian rubles',
        'BYN': 'belarusian rubles',
        'UAH': 'ukrainian hryvnias',
        'MDL': 'moldovan leu',
        'GEL': 'georgian lari',
        'AMD': 'armenian drams',
        'AZN': 'azerbaijani manat',
        'FJD': 'fijian dollars',
        'TOP': 'tongan paanga',
        'WST': 'samoan tala',
        'VUV': 'vanuatu vatu',
        'SBD': 'solomon islands dollars',
        'PGK': 'papua new guinea kina'
    };

    return currencyMap[currency] || 'dollars';
}

function formatGiftCount(count, giftType) {
    const numCount = Number(count);
    if (!numCount || numCount === 0) return `0 ${giftType.toLowerCase()}s`;

    if (numCount === 1) {
        if (giftType.toLowerCase() === 'bits') {
            return '1 bit';
        }
        if (giftType.toLowerCase().endsWith(' bits')) {
            const cheermoteType = giftType.replace(/ bits$/i, '');
            return `1 ${cheermoteType} bit`;
        }
        const singularName = giftType.toLowerCase();
        return `1 ${singularName}`;
    }

    if (giftType.toLowerCase() === 'bits') {
        return `${numCount} bits`;
    }
    if (giftType.toLowerCase().endsWith(' bits')) {
        const cheermoteType = giftType.replace(/ bits$/i, '');
        return `${numCount} ${cheermoteType} bits`;
    }
    let pluralGiftType = giftType.toLowerCase();
    if (!pluralGiftType.endsWith('s')) {
        pluralGiftType += 's';
    }

    return `${numCount} ${pluralGiftType}`;
}

function formatViewerCount(count) {
    const numCount = Number(count);
    if (!numCount || numCount === 0) return '0 viewers';
    return numCount === 1 ? '1 viewer' : `${numCount} viewers`;
}

function formatMonths(months) {
    const numMonths = Number(months);
    if (!numMonths || numMonths === 0) return '0 months';
    return numMonths === 1 ? '1 month' : `${numMonths} months`;
}

function getValidNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const num = Number(value);

    if (isNaN(num) || !isFinite(num)) {
        return null;
    }

    return Math.max(0, num);
}

module.exports = {
    formatCoins,
    formatSuperChatAmount,
    formatCurrencyForTTS,
    getCurrencyWord,
    formatGiftCount,
    formatViewerCount,
    formatMonths,
    NOTIFICATION_TEMPLATES
};
