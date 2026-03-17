/**
 * Entry point: Voucher Upload Bot - Telegram
 *
 * Commands:
 *   /create   — Upload new vouchers to ESB ERP via Excel file
 *   /activate — Activate vouchers via Excel file
 *   /check    — Check voucher info by code
 *   /status   — Check bot status
 *   /help     — Show usage guide
 *
 * Run with: node index.js
 */
require('dotenv').config();
const logger = require('./src/utils/logger');
const { sendStartNotification } = require('./src/telegram/notifications');
const { startBot } = require('./src/telegram/bot');

const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     VOUCHER BOT - ESB ERP TELEGRAM       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  await sendStartNotification(CHAT_ID);

  console.log('📱 Starting Telegram Bot...');
  console.log('   Send /start to see available commands\n');

  await startBot();
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
