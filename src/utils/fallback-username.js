const { config } = require('../core/config');

const getFallbackUsername = () => config.general.fallbackUsername;

module.exports = { getFallbackUsername };
