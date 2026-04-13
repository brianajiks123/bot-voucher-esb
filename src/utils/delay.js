const logger = require('./logger');

function delay(ms) {
  return new Promise((resolve) => {
    logger.debug(`Delaying for ${ms}ms...`);
    setTimeout(resolve, ms);
  });
}

module.exports = { delay };
