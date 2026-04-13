const path = require('path');
const logger = require('../../utils/logger');
const { reply, esc, parseCodesAndDate } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { formatVoucherResult, replyIfLimitExceeded } = require('./voucherResult');

async function processExtend(chatId, userId, text, credentials) {
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
  await reply(chatId, `⏳ Memperpanjang ${codes.length} voucher hingga ${esc(date)}...\nMohon tunggu.`);
  logger.info(`Extend ${codes.length} voucher(s) -> ${date}`);

  try {
    const { extendVoucherCodes } = require(
      path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await extendVoucherCodes(credentials, codes, date);
    const success = results.filter((r) => r.success);
    const failed  = results.filter((r) => !r.success);
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    let msg = `${icon} - *Ubah Masa Berlaku Voucher*\n\n`;
    msg += `📅 Waktu: ${new Date().toLocaleString('id-ID')}\n`;
    msg += `📊 Total: ${results.length} | ✅ Berhasil: ${success.length} | ❌ Gagal: ${failed.length}\n\n`;
    msg += '─────────────────────\n';
    for (const r of results) {
      msg += `${esc(formatVoucherResult(r, `Diperpanjang hingga ${date}`))}\n`;
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error(`Extend error: ${err.message}`);
    await reply(chatId, `❌ *Gagal memUbah Masa Berlaku voucher*\n\n${esc(err.message)}`, mainKeyboard());
  }
}

module.exports = { processExtend };
