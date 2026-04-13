const path = require('path');
const logger = require('../../utils/logger');
const { reply, esc, parseCodesForActivate } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { acquireLock, releaseLock, getLockState } = require('../processingState');
const { replyIfLimitExceeded } = require('./voucherResult');

const ACTIVATE_PURPOSE = 'voucher';

async function processActivateByCode(chatId, userId, text, credentials) {
  clearState(userId);
  const parsed = parseCodesForActivate(text);
  if (!parsed) {
    await reply(chatId,
      '❌ *Format tidak valid.*\n\nGunakan: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\nContoh: VOUCHER01, VOUCHER02\nContoh dengan tanggal: VOUCHER01, VOUCHER02 | 27-03-2026',
      mainKeyboard()
    );
    return;
  }

  const { codes, date } = parsed;

  if (await replyIfLimitExceeded(chatId, codes, reply, mainKeyboard())) return;
  const { isProcessing, currentProcess } = getLockState();
  if (isProcessing) {
    await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
    return;
  }

  acquireLock(`ACTIVATE_CODE oleh user ${userId}`);
  await reply(chatId, `⏳ Memproses aktivasi ${codes.length} voucher...\nMohon tunggu.`);
  logger.info(`Activate by code: ${codes.join(', ')} | purpose: ${ACTIVATE_PURPOSE} | date: ${date}`);

  try {
    const { activateVoucherByCodes } = require(
      path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await activateVoucherByCodes(credentials, codes, ACTIVATE_PURPOSE, date);

    const success = results.filter((r) => r.success);
    const failed  = results.filter((r) => !r.success);
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    let msg = `${icon} - *Aktivasi Voucher*\n\n`;
    msg += `📅 Waktu: ${new Date().toLocaleString('id-ID')}\n`;
    msg += `📊 Total: ${results.length} | ✅ Berhasil: ${success.length} | ❌ Gagal: ${failed.length}\n\n`;
    msg += '─────────────────────\n';

    for (const r of results) {
      if (r.success)                             msg += `✅ ${esc(r.voucherCode)}: Berhasil diaktivasi\n`;
      else if (r.reason === 'not_found')         msg += `🔍 ${esc(r.voucherCode)}: Voucher tidak ditemukan\n`;
      else if (r.reason === 'not_available')     msg += `⚠️ ${esc(r.voucherCode)}: Status ${esc(r.status)}\n`;
      else if (r.reason === 'button_unavailable') msg += `⚠️ ${esc(r.voucherCode)}: Tombol aktivasi tidak tersedia (status: ${esc(r.status)})\n`;
      else                                       msg += `❌ ${esc(r.voucherCode)}: ${esc(r.message || 'Gagal')}\n`;
    }

    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error(`Activate by code error: ${err.message}`);
    await reply(chatId, `❌ *Gagal mengaktivasi voucher*\n\n${esc(err.message)}`, mainKeyboard());
  } finally {
    releaseLock();
  }
}

module.exports = { processActivateByCode };
