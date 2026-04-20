/**
 * Commands:
 *   /create   — Upload new vouchers to ESB ERP via Excel file
 *   /activate — Activate vouchers via Excel file
 *   /check    — Check voucher info by code
 *   /extend   — Extend voucher expiry date
 *   /delete   — Delete vouchers
 *   /restore  - Restore vouchers
 *   /status   — Check bot status
 *   /help     — Show usage guide
 *
 * Run: node index.js
 */
require('dotenv').config();
const logger = require('./src/utils/logger');
const { startBot } = require('./src/telegram/bot');

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     VOUCHER BOT - ESB ERP TELEGRAM       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await startBot();
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
