const path = require('path');
const logger = require('../../utils/logger');
const { reply, esc, parseCodesAndDate } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { formatVoucherResult, replyIfLimitExceeded } = require('./voucherResult');

async function processRestore(chatId, userId, text, credentials) {
  clearState(userId);
  const parsed = parseCodesAndDate(text);
  if (!parsed) {
    await reply(chatId,
      '❌ *Format tidak valid.*\n\nGunakan: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\nContoh: VOUCHER01, VOUCHER02 | 31-12-2025',
      mainKeyboard()
    );
    return;
  }

  const { codes, date } = parsed;

  if (await replyIfLimitExceeded(chatId, codes, reply, mainKeyboard())) return;
  await reply(chatId, `⏳ Me-restore ${codes.length} voucher...\nMohon tunggu.`);
  logger.info(`Restore ${codes.length} voucher(s) | date: ${date}`);

  try {
    const { restoreVoucherCodes } = require(
      path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await restoreVoucherCodes(credentials, codes, date);
    const success = results.filter((r) => r.success);
    const failed  = results.filter((r) => !r.success);
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    await reply(chatId,
      `${icon} - *Restore Voucher*\n\n` +
      `📅 Waktu: ${new Date().toLocaleString('id-ID')}\n` +
      `📊 Total: ${results.length} | ✅ Berhasil: ${success.length} | ❌ Gagal: ${failed.length}`
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isLast = i === results.length - 1;
      const kb = isLast ? mainKeyboard() : null;
      await reply(chatId, esc(formatVoucherResult(r, 'Berhasil di-restore')), kb);
    }
  } catch (err) {
    logger.error(`Restore error: ${err.message}`);
    await reply(chatId, `❌ *Gagal me-restore voucher*\n\n${esc(err.message)}`, mainKeyboard());
  }
}

module.exports = { processRestore };
