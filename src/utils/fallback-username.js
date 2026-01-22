const { config } = require('../core/config');

const getFallbackUsername = () => config.general.fallbackUsername;
const getAnonymousUsername = () => config.general.anonymousUsername;

module.exports = { getFallbackUsername, getAnonymousUsername };
