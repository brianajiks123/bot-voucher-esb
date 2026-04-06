const { reply, esc } = require('../helpers');
const { setState } = require('../state');
const { mainKeyboard, createOptionsKeyboard, activateOptionsKeyboard } = require('../keyboard');
const { getLockState } = require('../processingState');
const { BRANCH_LIST } = require('../../config/credentials');

async function handleStart(chatId) {
  await reply(chatId,
    '🤖 *Voucher Bot - ESB ERP*\n\n' +
    'Pilih command:\n\n' +
    '📤 /create - Upload voucher baru\n' +
    '✅ /activate - Aktivasi voucher\n' +
    '🔍 /check - Cek info voucher\n' +
    '📅 /extend - Perpanjang expired voucher\n' +
    '🗑️ /delete - Hapus voucher\n' +
    '📊 /status - Status bot\n' +
    '❓ /help - Panduan penggunaan',
    mainKeyboard()
  );
}

async function handleCreate(chatId, userId) {
  const { isProcessing, currentProcess } = getLockState();
  if (isProcessing) {
    await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
    return;
  }
  setState(userId, 'CREATE_METHOD_SELECT', {});
  await reply(chatId, '📤 *Upload Voucher Baru*\n\nPilih metode:', createOptionsKeyboard());
}

async function handleActivate(chatId, userId) {
  const { isProcessing, currentProcess } = getLockState();
  if (isProcessing) {
    await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
    return;
  }
  setState(userId, 'ACTIVATE_METHOD_SELECT', {});
  await reply(chatId, '✅ *Aktivasi Voucher*\n\nPilih metode aktivasi:', activateOptionsKeyboard());
}

async function handleStatus(chatId) {
  const { isProcessing, currentProcess } = getLockState();
  const status = isProcessing ? '🔄 Sedang berjalan' : '✅ Siap';
  await reply(chatId,
    `📊 *Status Bot*\n\nStatus: ${esc(status)}\nProses: ${esc(currentProcess || '-')}\n📅 Waktu: ${new Date().toLocaleString('id-ID')}`,
    mainKeyboard()
  );
}

async function handleHelp(chatId) {
  await reply(chatId,
    '❓ *Panduan Penggunaan*\n\n' +
    '📤 *Upload Voucher Baru (/create) — 2 opsi:*\n' +
    '1. Kirim /create\n' +
    '2. Pilih opsi: Via File Excel atau Generate\n' +
    '   a. Via File: pilih branch → kirim file .xlsx/.xls\n' +
    '   b. Generate: pilih tipe → pilih branch → kirim data\n' +
    '      Bot generate Excel, upload ke ESB ERP,\n' +
    '      lalu kirim file .zip hasil generate ke Anda\n\n' +
    '⚡ *Format Generate (/create → Generate):*\n' +
    '`[mode] [branch] [length] [start date] [start month] - [end date] [end month] [year] [min. sales] [amount-qty] "Notes"`\n\n' +
    '1️⃣ Single — satu file untuk seluruh periode\n' +
    '   `single plb 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n' +
    '2️⃣ Multiple — satu file per tanggal\n' +
    '   `multiple ven 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n' +
    '3️⃣ Custom Prefix — prefix kustom dalam tanda kutip\n' +
    '   `single gom "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n' +
    '4️⃣ Custom Branch — branch di kolom "Can Use on Branch"\n' +
    '   `single "gom, plb" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n' +
    '5️⃣ Custom Prefix + Branch — gabungan prefix & custom branch\n' +
    '   `single "gom, plb" "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n' +
    '6️⃣ Multiple Amount — beberapa nominal, pisah spasi\n' +
    '   `single bsb 30 1 4 - 30 4 2026 0 10000-15 20000-12 "Promo"`\n' +
    '7️⃣ Multiple Branches — pisahkan dengan ` | `\n' +
    '   `single ven "VO" 30 1 4 - 30 4 2026 0 5000-10 "Test" | multiple ideo 30 1 4 - 30 4 2026 0 5000-10 "Test"`\n\n' +
    '✅ *Aktivasi Voucher (/activate) — 2 opsi:*\n' +
    '1. Kirim /activate\n' +
    '2. Pilih opsi: Via File Excel atau Input Kode Voucher\n' +
    '   a. Via File: pilih branch → kirim file .xlsx/.xls\n' +
    '   b. Input Kode: pilih branch → kirim kode voucher\n' +
    '      Format: KODE1, KODE2 | DD-MM-YYYY (tanggal opsional)\n\n' +
    '🔍 *Cek Voucher (/check):*\n' +
    '1. Kirim /check → pilih branch → kirim kode voucher\n\n' +
    '📅 *Ubah Masa Berlaku Voucher (/extend):*\n' +
    '1. Kirim /extend → pilih branch → kirim kode\n' +
    '   Format: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\n\n' +
    '🗑️ *Hapus Voucher (/delete):*\n' +
    '1. Kirim /delete → pilih branch → kirim kode\n' +
    '   Format: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\n\n' +
    '🏪 *Branch alias yang valid:*\n' +
    'ideo | ven | bsb | gom | plb\n' +
    'burgas gombel | burgas pleburan\n\n' +
    '🏪 *Branch yang tersedia:*\n' + BRANCH_LIST + '\n\n' +
    '📌 *Catatan:*\n' +
    '- Hanya 1 proses berjalan bersamaan\n' +
    '- Sesi kedaluwarsa dalam 5 menit\n' +
    '- File dihapus otomatis setelah diproses',
    mainKeyboard()
  );
}

module.exports = { handleStart, handleCreate, handleActivate, handleStatus, handleHelp };
