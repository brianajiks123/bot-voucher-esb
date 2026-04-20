const logger = require('../utils/logger');
const { delay } = require('../utils/delay');
const { getUpdates, validateToken, isConfigured, setMyCommands } = require('./telegramClient');
const { sendStartNotification } = require('./notifications');
const { handleMessage } = require('./handlers/messages');
const { handleCallbackQuery } = require('./handlers/callbacks');

const BOT_COMMANDS = [
  { command: 'create',   description: 'Upload voucher baru ke ESB ERP' },
  { command: 'activate', description: 'Aktivasi voucher via file Excel' },
  { command: 'check',    description: 'Cek info voucher by kode' },
  { command: 'extend',   description: 'Perpanjang expired voucher' },
  { command: 'delete',   description: 'Hapus voucher' },
  { command: 'restore',  description: 'Restore voucher' },
  { command: 'status',   description: 'Status bot' },
  { command: 'help',     description: 'Panduan penggunaan' },
];

async function startBot() {
  logger.info('Starting Voucher Bot...');

  if (!isConfigured()) {
    logger.warn('Telegram not configured. Bot will not start.');
    return;
  }

  const isValid = await validateToken();
  if (!isValid) {
    logger.warn('Bot token invalid. Bot will not start.');
    return;
  }

  logger.info('Bot ready. Waiting for commands...');
  await setMyCommands(BOT_COMMANDS);
  await sendStartNotification();

  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message)        await handleMessage(update.message);
        if (update.callback_query) await handleCallbackQuery(update.callback_query);
      }
    } catch (err) {
      logger.error(`Bot loop error: ${err.message}`);
      await delay(5000);
    }
  }
}

module.exports = { startBot };
