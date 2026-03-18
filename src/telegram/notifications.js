/**
 * notifications.js
 * Message templates for bot notifications: startup, upload result, fatal error.
 */

const { sendMessage } = require('./telegramClient');
const { mainKeyboard } = require('./keyboard');
const logger = require('../utils/logger');

/**
 * Sent to the configured chat when the bot process starts.
 * @param {string|number} [chatId] - Target chat ID; falls back to TELEGRAM_CHAT_ID from env.
 */
async function sendStartNotification(chatId) {
  const message = `🚀 *Voucher Bot Started*

📅 Time: ${new Date().toLocaleString('id-ID')}
🤖 Status: Bot is running

*Available commands:*
• /create — Upload new vouchers to ESB ERP
• /activate — Activate vouchers via Excel file
• /check — Check voucher info by code
• /extend — Extend voucher expiry date
• /delete — Delete voucher
• /status — Check bot status
• /help — Usage guide`;

  return sendMessage(message, chatId || undefined, mainKeyboard());
}

/**
 * Escape special legacy Markdown characters in dynamic text.
 * @param {*} text
 */
function escapeMd(text) {
  return String(text).replace(/[_*`[]/g, '\\$&');
}

/**
 * Sent after an upload job finishes, with a per-file result summary.
 * @param {string|number} chatId
 * @param {'CREATE'|'ACTIVATE'} mode
 * @param {Array<{file: string, status: string, message?: string}>} results
 */
async function sendUploadResultNotification(chatId, mode, results) {
  try {
    const success = results.filter((r) => r.status.includes('Success'));
    const failed  = results.filter((r) => !r.status.includes('Success'));

    const modeLabel   = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
    const overallIcon = failed.length === 0 ? '✅' : success.length === 0 ? '❌' : '⚠️';

    let message = `${overallIcon} *${modeLabel} Selesai*\n\n`;
    message += `📅 ${new Date().toLocaleString('id-ID')}\n`;
    message += `📊 Total: ${results.length} | ✅ Berhasil: ${success.length} | ❌ Gagal: ${failed.length}\n`;
    message += `\n─────────────────────\n`;

    results.forEach((r, i) => {
      const icon     = r.status.includes('Success') ? '✓' : '✗';
      const safeFile = r.file.replace(/_/g, '\\_');
      message += `\n${i + 1}. ${icon} \`${safeFile}\``;
      if (r.message) message += `\n   └ ${escapeMd(r.message)}`;
    });

    if (failed.length > 0) {
      message += `\n\n─────────────────────\n`;
      message += `⚠️ *Terdapat ${failed.length} file gagal.*\n`;
      message += `Silakan upload ulang file yang gagal dengan command /${mode.toLowerCase()}`;
    }

    return sendMessage(message, chatId, mainKeyboard());
  } catch (err) {
    logger.error(`sendUploadResultNotification error: ${err.message}`);
    return false;
  }
}

/**
 * Sent when a fatal error occurs before any file is processed.
 * Includes a contextual hint based on the error message.
 * @param {string|number} chatId
 * @param {'CREATE'|'ACTIVATE'} mode
 * @param {string} errorMessage
 */
async function sendFatalErrorNotification(chatId, mode, errorMessage) {
  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';

  let hint = 'Silakan coba lagi beberapa saat.';
  if (/login|credential|password|username/i.test(errorMessage)) {
    hint = 'Kemungkinan kredensial ESB salah atau sesi bermasalah. Hubungi admin.';
  } else if (/timeout|network|ECONNREFUSED/i.test(errorMessage)) {
    hint = 'Koneksi ke ESB ERP bermasalah. Coba lagi beberapa saat.';
  }

  const message = `❌ *${modeLabel} Gagal*\n\n📅 ${new Date().toLocaleString('id-ID')}\n\n*Penyebab:*\n\`${escapeMd(errorMessage)}\`\n\n💡 ${hint}\n\nGunakan command /${mode.toLowerCase()} untuk mencoba lagi.`;

  return sendMessage(message, chatId, mainKeyboard());
}

module.exports = { sendStartNotification, sendUploadResultNotification, sendFatalErrorNotification };
