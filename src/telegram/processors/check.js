const path = require('path');
const logger = require('../../utils/logger');
const { reply, esc } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');

const MAX_VOUCHER_PER_REQUEST = 100;

async function processVoucherCheck(chatId, userId, text, credentials) {
  clearState(userId);
  const codes = text.split(',').map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) {
    await reply(chatId, '❌ Kode voucher tidak valid.', mainKeyboard());
    return;
  }

  if (codes.length > MAX_VOUCHER_PER_REQUEST) {
    await reply(chatId,
      `⚠️ *Terlalu banyak kode voucher*\n\n` +
      `Kamu mengirim *${codes.length} kode*, maksimal *${MAX_VOUCHER_PER_REQUEST} kode* per request.\n\n` +
      `Silakan bagi menjadi beberapa batch dan kirim ulang.`,
      mainKeyboard()
    );
    return;
  }

  await reply(chatId, `🔍 Mencari ${codes.length} voucher...\nMohon tunggu.`);
  try {
    const { checkVoucherCodes } = require(
      path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await checkVoucherCodes(credentials, codes);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isLast = i === results.length - 1;
      const kb = isLast ? mainKeyboard() : null;

      if (!r.found) {
        const errNote = r.error ? `\n⚠️ _${esc(r.error)}_` : '';
        await reply(chatId, `🔍 \`${esc(r.voucherCode)}\`\n❌ Voucher tidak ditemukan.${errNote}`, kb);
        continue;
      }

      const d = r.data;
      await reply(chatId,
        `🎟️ *${esc(d.voucherCode)}*\n\n` +
        `🏪 Branch: ${esc(d.branch)}\n` +
        `📅 Start Date: ${esc(d.startDate)}\n` +
        `📅 End Date: ${esc(d.endDate)}\n` +
        `💰 Min. Sales Amount: ${esc(d.minSalesAmount)}\n` +
        `💵 Voucher Amount: ${esc(d.voucherAmount)}\n` +
        `🏷️ Voucher Sales Price: ${esc(d.voucherSalesPrice)}\n` +
        `ℹ️ Additional Info: ${esc(d.additionalInfo)}\n` +
        `📌 Status: ${esc(d.status)}`,
        kb
      );
    }
  } catch (err) {
    logger.error(`Check voucher error: ${err.message}`);
    await reply(chatId, `❌ *Gagal mengecek voucher*\n\n${esc(err.message)}`, mainKeyboard());
  }
}

module.exports = { processVoucherCheck };
