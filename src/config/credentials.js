/**
 * ESB ERP credentials loaded from environment variables
 */
const credentials = {
  username: process.env.ESB_USERNAME || '',
  password: process.env.ESB_PASSWORD || '',
};

module.exports = { credentials };
