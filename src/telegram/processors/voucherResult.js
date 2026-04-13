const MAX_VOUCHER_PER_REQUEST = 100;

function formatVoucherResult(r, successMsg) {
  if (r.success)                             return `✅ ${r.voucherCode}: ${successMsg}`;
  if (r.reason === 'not_found')              return `🔍 ${r.voucherCode}: Voucher tidak ditemukan`;
  if (r.reason === 'button_unavailable')     return `⚠️ ${r.voucherCode}: status ${r.status}`;
  return `❌ ${r.voucherCode}: ${r.message || 'Gagal'}`;
}

async function replyIfLimitExceeded(chatId, codes, replyFn, keyboard) {
  if (codes.length <= MAX_VOUCHER_PER_REQUEST) return false;
  await replyFn(chatId,
    `⚠️ *Terlalu banyak kode voucher*\n\n` +
    `Kamu mengirim *${codes.length} kode*, maksimal *${MAX_VOUCHER_PER_REQUEST} kode* per request.\n` +
    `Silakan bagi menjadi beberapa batch dan kirim ulang.`,
    keyboard
  );
  return true;
}

module.exports = { formatVoucherResult, replyIfLimitExceeded, MAX_VOUCHER_PER_REQUEST };
