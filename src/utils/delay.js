const logger = require('./logger');

/**
 * Delay execution for ms milliseconds
 */
function delay(ms) {
  return new Promise((resolve) => {
    logger.debug(`Delaying for ${ms}ms...`);
    setTimeout(resolve, ms);
  });
}

module.exports = { delay };
