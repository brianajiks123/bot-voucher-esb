function formatVoucherResult(r, successMsg) {
  if (r.success)                             return `✅ ${r.voucherCode}: ${successMsg}`;
  if (r.reason === 'not_found')              return `🔍 ${r.voucherCode}: Voucher tidak ditemukan`;
  if (r.reason === 'button_unavailable')     return `⚠️ ${r.voucherCode}: status ${r.status}`;
  return `❌ ${r.voucherCode}: ${r.message || 'Gagal'}`;
}

module.exports = { formatVoucherResult };
