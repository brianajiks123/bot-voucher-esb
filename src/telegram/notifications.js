const { sendMessage, sendDocument } = require('./telegramClient');
const { mainKeyboard } = require('./keyboard');
const logger = require('../utils/logger');

async function sendStartNotification(chatId) {
  const message = `🚀 *Voucher Bot Started*

📅 Time: ${new Date().toLocaleString('id-ID')}
🤖 Status: Bot is running and ready!

*Available commands:*
📤 /create — Upload voucher baru ke ERP ESB
✅ /activate — Aktivasi voucher via file excel
🔍 /check — Cek info voucher berdasarkan kode
📅 /extend — Perpanjang masa berlaku voucher
🗑️ /delete — Hapus voucher
📊 /status — Cek status bot
❓ /help — Panduan`;

  return sendMessage(message, chatId || undefined, mainKeyboard());
}

function escapeMd(text) {
  return String(text).replace(/[_*`[]/g, (c) => '\\' + c);
}

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
      const icon = r.status.includes('Success') ? '✅' : '❌';
      message += `\n${i + 1}. ${icon} \`${escapeMd(r.file)}\``;

      if (r.message && !r.status.includes('Success')) {
        const lines = r.message.split('\n').map((l) => l.trim()).filter(Boolean);
        lines.forEach((line) => {
          message += `\n   ${escapeMd(line)}`;
        });
      } else if (r.message) {
        message += `\n   └ ${escapeMd(r.message)}`;
      }
    });

    if (failed.length > 0) {
      message += `\n\n─────────────────────\n`;
      message += `⚠️ *Terdapat ${failed.length} file gagal.*\n`;
      message += `🔄 Silakan upload ulang file yang gagal dengan command /${mode.toLowerCase()}`;
    }

    return sendMessage(message, chatId, mainKeyboard());
  } catch (err) {
    logger.error(`sendUploadResultNotification error: ${err.message}`);
    return false;
  }
}

async function sendFatalErrorNotification(chatId, mode, errorMessage) {
  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';

  let hint = 'Silakan coba lagi beberapa saat.';
  if (/login gagal|invalid.*password|username.*password|password.*salah|oops/i.test(errorMessage)) {
    hint = 'Kredensial ESB salah. Periksa username/password di konfigurasi dan hubungi admin.';
  } else if (/login|credential|password|username/i.test(errorMessage)) {
    hint = 'Kemungkinan kredensial ESB salah atau sesi bermasalah. Hubungi admin.';
  } else if (/timeout|network|ECONNREFUSED/i.test(errorMessage)) {
    hint = 'Koneksi ke ESB ERP bermasalah. Coba lagi beberapa saat.';
  }

  const message = `❌ *${modeLabel} Gagal*\n\n📅 ${new Date().toLocaleString('id-ID')}\n\n*Penyebab:*\n\`${escapeMd(errorMessage)}\`\n\n💡 ${hint}\n\nGunakan command /${mode.toLowerCase()} untuk mencoba lagi.`;

  return sendMessage(message, chatId, mainKeyboard());
}

async function sendErrorFileToTelegram(chatId, filePath, fileName) {
  try {
    const caption = `📎 *File Error ESB*\n\`${escapeMd(fileName)}\`\n\nFile ini berisi detail baris yang gagal diupload ke ESB ERP.`;
    return sendDocument(filePath, chatId, caption);
  } catch (err) {
    logger.error(`sendErrorFileToTelegram error: ${err.message}`);
    return false;
  }
}

module.exports = { sendStartNotification, sendUploadResultNotification, sendFatalErrorNotification, sendErrorFileToTelegram };
