const path = require('path');
const { sendMessage, sendDocument, getUpdates, validateToken, isConfigured, getBotToken, setMyCommands, answerCallbackQuery } = require('./telegramClient');
const { sendUploadResultNotification, sendFatalErrorNotification, sendErrorFileToTelegram } = require('./notifications');
const { mainKeyboard, createOptionsKeyboard, activateOptionsKeyboard, generateModeKeyboard } = require('./keyboard');
const { resolveBranchKey, BRANCH_DISPLAY, getCredentialsForBranch, BRANCH_LIST } = require('../config/credentials');
const { createTempFolder, deleteTempFolder, downloadTelegramFile } = require('../utils/tempFiles');
const { generateVouchers } = require('../voucher/generator');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

const userStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000;

let isProcessing = false;
let currentProcess = null;

function setState(userId, mode, extra) {
  userStates.set(userId, { mode, expiresAt: Date.now() + STATE_TTL_MS, ...extra });
}

function getState(userId) {
  const state = userStates.get(userId);
  if (!state) return null;
  if (Date.now() > state.expiresAt) { userStates.delete(userId); return null; }
  return state;
}

function clearState(userId) { userStates.delete(userId); }

function reply(chatId, text, replyMarkup) {
  return sendMessage(text, chatId, replyMarkup || null);
}

function esc(text) {
  return String(text).replace(/[_*`[]/g, '\\$&');
}

function parseCommand(text) {
  return text ? text.trim().toLowerCase().replace(/@\S+$/, '') : '';
}

function parseCodesAndDate(text) {
  const parts = text.split('|').map(function(p) { return p.trim(); });
  const codes = parts[0].split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (codes.length === 0) return null;

  let date;
  if (parts.length >= 2) {
    date = parts[1];
    const match = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    const dd = match[1], mm = match[2], yyyy = match[3];
    if (isNaN(new Date(yyyy + '-' + mm + '-' + dd).getTime())) return null;
  } else {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    date = dd + '-' + mm + '-' + yyyy;
  }
  return { codes: codes, date: date };
}

function extractInlineData(rawText) {
  const spaceIdx = rawText.indexOf(' ');
  if (spaceIdx === -1) return null;
  const data = rawText.slice(spaceIdx + 1).trim();
  return data.length > 0 ? data : null;
}

const ACTIVATE_PURPOSE = 'voucher';

function parseCodesForActivate(text) {
  const parts = text.split('|').map(function(p) { return p.trim(); });
  const codes = parts[0].split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (codes.length === 0) return null;

  let date;
  if (parts.length >= 2) {
    const d = parts[1];
    const match = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    const dd = match[1], mm = match[2], yyyy = match[3];
    if (isNaN(new Date(yyyy + '-' + mm + '-' + dd).getTime())) return null;
    date = d;
  } else {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    date = dd + '-' + mm + '-' + yyyy;
  }
  return { codes: codes, date: date };
}

// --- Branch Selection ---------------------------------------------------------

async function askBranch(chatId, userId, pendingMode, pendingData) {
  setState(userId, 'BRANCH_SELECT', { pendingMode, pendingData: pendingData || null });
  await reply(chatId,
    '🏪 *Pilih Branch*\n\n' + BRANCH_LIST + '\n\n📝 Kirim nama branch yang sesuai.',
    mainKeyboard()
  );
}

async function handleBranchReply(chatId, userId, text, state) {
  const branchKey = resolveBranchKey(text);
  if (!branchKey) {
    await reply(chatId,
      '❓ Branch tidak dikenali. Pilih salah satu:\n\n' + BRANCH_LIST,
      mainKeyboard()
    );
    return;
  }

  const branchDisplay = BRANCH_DISPLAY[branchKey];
  const credentials   = getCredentialsForBranch(branchKey);
  const pendingMode   = state.pendingMode;
  const pendingData   = state.pendingData;
  const pendingFileId   = state.pendingFileId   || null;
  const pendingFileName = state.pendingFileName || null;

  clearState(userId);
  await reply(chatId, '🏪 Branch: ' + esc(branchDisplay) + '\n⏳ Memproses ' + esc(pendingMode) + '...');

  if (pendingMode === 'CREATE' || pendingMode === 'ACTIVATE') {
    if (pendingFileId && pendingFileName) {
      await processVoucherUpload(chatId, userId, pendingMode, pendingFileId, pendingFileName, credentials);
    } else {
      setState(userId, pendingMode, { branchKey, credentials });
      await reply(chatId,
        '📂 Kirim file Excel (.xlsx / .xls) untuk ' + esc(pendingMode) + ' voucher branch ' + esc(branchDisplay) + '.\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.',
        mainKeyboard()
      );
    }
  } else if (pendingMode === 'ACTIVATE_CODE') {
    if (pendingData) {
      await processActivateByCode(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'ACTIVATE_CODE', { branchKey, credentials });
      await reply(chatId,
        '🎟️ *Aktivasi Voucher (Kode)* - ' + esc(branchDisplay) + '\n\nKirim kode voucher. Pisahkan dengan koma jika lebih dari satu.\nTanggal opsional, tambahkan | DD-MM-YYYY jika ingin menentukan tanggal.\n\n📋 Contoh:\nVOUCHER01, VOUCHER02\nVOUCHER01, VOUCHER02 | 27-03-2026\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.',
        mainKeyboard()
      );
    }
  } else if (pendingMode === 'CHECK') {
    setState(userId, 'CHECK', { branchKey, credentials });
    await reply(chatId,
      '🔍 *Cek Voucher* - ' + esc(branchDisplay) + '\n\nKirim kode voucher. Pisahkan dengan koma jika lebih dari satu.\n\n📋 Contoh: VOUCHER01, VOUCHER02\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.',
      mainKeyboard()
    );
  } else if (pendingMode === 'EXTEND') {
    if (pendingData && pendingData.includes('|')) {
      await processExtend(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'EXTEND', { branchKey, credentials });
      await handleExtend(chatId, branchDisplay);
    }
  } else if (pendingMode === 'DELETE') {
    if (pendingData && pendingData.includes('|')) {
      await processDelete(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'DELETE', { branchKey, credentials });
      await handleDelete(chatId, branchDisplay);
    }
  }
}

// --- Upload Processor ---------------------------------------------------------

async function processVoucherUpload(chatId, userId, mode, fileId, fileName, credentials) {
  if (isProcessing) {
    await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
    return;
  }

  isProcessing = true;
  currentProcess = mode + ' oleh user ' + userId;
  clearState(userId);

  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
  await reply(chatId, '📂 File diterima: ' + esc(fileName) + '\n⏳ Sedang memproses ' + esc(modeLabel) + '...');

  let tempFolder = null;
  try {
    tempFolder = await createTempFolder(userId, mode.toLowerCase());
    await downloadTelegramFile(getBotToken(), fileId, fileName, tempFolder);

    await reply(chatId, '🔄 Sedang upload ke ESB ERP...\nMohon tunggu beberapa menit.');

    const { voucherUploadOrchestrate } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/orchestrator')
    );
    const results = await voucherUploadOrchestrate({ credentials: credentials, folderPath: tempFolder }, mode);
    await sendUploadResultNotification(chatId, mode, results);

    const failedWithFile = results.filter((r) => !r.status.includes('Success') && r.errorFilePath);
    for (const r of failedWithFile) {
      await sendErrorFileToTelegram(chatId, r.errorFilePath, r.file);
    }
  } catch (err) {
    logger.error('Upload [' + mode + '] error: ' + err.message);
    await sendFatalErrorNotification(chatId, mode, err.message);
    if (err.errorFilePath) {
      await sendErrorFileToTelegram(chatId, err.errorFilePath, fileName);
    }
  } finally {
    if (tempFolder) await deleteTempFolder(tempFolder);
    isProcessing = false;
    currentProcess = null;
  }
}

// --- Command Handlers ---------------------------------------------------------

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
  if (isProcessing) {
    await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
    return;
  }
  setState(userId, 'CREATE_METHOD_SELECT', {});
  await sendMessage(
    '📤 *Upload Voucher Baru*\n\nPilih metode:',
    chatId,
    createOptionsKeyboard()
  );
}

async function handleActivate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
    return;
  }
  setState(userId, 'ACTIVATE_METHOD_SELECT', {});
  await sendMessage(
    '✅ *Aktivasi Voucher*\n\nPilih metode aktivasi:',
    chatId,
    activateOptionsKeyboard()
  );
}

async function handleStatus(chatId) {
  const status = isProcessing ? '🔄 Sedang berjalan' : '✅ Siap';
  await reply(chatId, '📊 *Status Bot*\n\nStatus: ' + esc(status) + '\nProses: ' + esc(currentProcess || '-') + '\n📅 Waktu: ' + new Date().toLocaleString('id-ID'), mainKeyboard());
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
    '⚡ *Tipe Generate (/create → Generate):*\n' +
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
    '   `single bsb 30 1 3 - 18 3 2026 0 10000-15 20000-12 "Promo"`\n' +
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
    '🏪 *Branch alias:* ven | bsb | gom | plb | ideo\n\n' +
    '🏪 *Branch yang tersedia:*\n' + BRANCH_LIST + '\n\n' +
    '📌 *Catatan:*\n' +
    '- Hanya 1 proses berjalan bersamaan\n' +
    '- Sesi kedaluwarsa dalam 5 menit\n' +
    '- File dihapus otomatis setelah diproses',
    mainKeyboard()
  );
}

async function handleCheck(chatId, userId) {
  await askBranch(chatId, userId, 'CHECK');
}

async function handleExtend(chatId, branchDisplay) {
  const label = branchDisplay ? ' - ' + esc(branchDisplay) : '';
  await reply(chatId,
    '📅 *Ubah Masa Berlaku Voucher*' + label + '\n\n' +
    'Kirim kode voucher. Tanggal opsional (default: hari ini).\n\n' +
    '📋 Format:\n' +
    'KODE1, KODE2\n' +
    'KODE1, KODE2 | DD-MM-YYYY\n\n' +
    '📝 Contoh:\n' +
    'VOUCHER01, VOUCHER02\n' +
    'VOUCHER01, VOUCHER02 | 31-12-2025',
    mainKeyboard()
  );
}

async function handleDelete(chatId, branchDisplay) {
  const label = branchDisplay ? ' - ' + esc(branchDisplay) : '';
  await reply(chatId,
    '🗑️ *Hapus Voucher*' + label + '\n\n' +
    'Kirim kode voucher. Tanggal opsional (default: hari ini).\n\n' +
    '📋 Format:\n' +
    'KODE1, KODE2\n' +
    'KODE1, KODE2 | DD-MM-YYYY\n\n' +
    '📝 Contoh:\n' +
    'VOUCHER01, VOUCHER02\n' +
    'VOUCHER01, VOUCHER02 | 31-12-2025',
    mainKeyboard()
  );
}

// --- Flow Processors ----------------------------------------------------------

async function processActivateByCode(chatId, userId, text, credentials) {
  clearState(userId);
  const parsed = parseCodesForActivate(text);
  if (!parsed) {
    await reply(chatId,
      '❌ *Format tidak valid.*\n\n' +
      'Gunakan: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\n' +
      'Contoh: VOUCHER01, VOUCHER02\n' +
      'Contoh dengan tanggal: VOUCHER01, VOUCHER02 | 27-03-2026',
      mainKeyboard()
    );
    return;
  }

  const { codes, date } = parsed;
  const purpose = ACTIVATE_PURPOSE;

  if (isProcessing) {
    await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
    return;
  }

  isProcessing = true;
  currentProcess = 'ACTIVATE_CODE oleh user ' + userId;

  await reply(chatId, '⏳ Memproses aktivasi ' + codes.length + ' voucher...\nMohon tunggu.');
  logger.info('Activate by code: ' + codes.join(', ') + ' | purpose: ' + purpose + ' | date: ' + date + ' (today default: ' + (text.includes('|') ? 'no' : 'yes') + ')');

  try {
    const { activateVoucherByCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await activateVoucherByCodes(credentials, codes, purpose, date);

    const success = results.filter(function(r) { return r.success; });
    const failed  = results.filter(function(r) { return !r.success; });
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    let msg = icon + ' - *Aktivasi Voucher*\n\n';
    msg += '📅 Waktu: ' + new Date().toLocaleString('id-ID') + '\n';
    msg += '📊 Total: ' + results.length + ' | ✅ Berhasil: ' + success.length + ' | ❌ Gagal: ' + failed.length + '\n\n';
    msg += '─────────────────────\n';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.success) {
        msg += '✅ ' + esc(r.voucherCode) + ': Berhasil diaktivasi\n';
      } else if (r.reason === 'not_found') {
        msg += '🔍 ' + esc(r.voucherCode) + ': Voucher tidak ditemukan\n';
      } else if (r.reason === 'not_available') {
        msg += '⚠️ ' + esc(r.voucherCode) + ': Status ' + esc(r.status) + '\n';
      } else if (r.reason === 'button_unavailable') {
        msg += '⚠️ ' + esc(r.voucherCode) + ': Tombol aktivasi tidak tersedia (status: ' + esc(r.status) + ')\n';
      } else {
        msg += '❌ ' + esc(r.voucherCode) + ': ' + esc(r.message || 'Gagal') + '\n';
      }
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error('Activate by code error: ' + err.message);
    await reply(chatId, '❌ *Gagal mengaktivasi voucher*\n\n' + esc(err.message), mainKeyboard());
  } finally {
    isProcessing = false;
    currentProcess = null;
  }
}

async function processVoucherCheck(chatId, userId, text, credentials) {
  clearState(userId);
  const codes = text.split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (codes.length === 0) { await reply(chatId, '❌ Kode voucher tidak valid.', mainKeyboard()); return; }

  await reply(chatId, '🔍 Mencari ' + codes.length + ' voucher...\nMohon tunggu.');
  try {
    const { checkVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await checkVoucherCodes(credentials, codes);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isLast = i === results.length - 1;
      const kb = isLast ? mainKeyboard() : null;
      if (!r.found) { await reply(chatId, '🔍 `' + esc(r.voucherCode) + '`\n❌ Voucher tidak ditemukan.', kb); continue; }
      const d = r.data;
      await reply(chatId,
        '🎟️ *' + esc(d.voucherCode) + '*\n\n' +
        '🏪 Branch: ' + esc(d.branch) + '\n' +
        '📅 Start Date: ' + esc(d.startDate) + '\n' +
        '📅 End Date: ' + esc(d.endDate) + '\n' +
        '💰 Min. Sales Amount: ' + esc(d.minSalesAmount) + '\n' +
        '💵 Voucher Amount: ' + esc(d.voucherAmount) + '\n' +
        '🏷️ Voucher Sales Price: ' + esc(d.voucherSalesPrice) + '\n' +
        'ℹ️ Additional Info: ' + esc(d.additionalInfo) + '\n' +
        '📌 Status: ' + esc(d.status),
        kb
      );
    }
  } catch (err) {
    logger.error('Check voucher error: ' + err.message);
    await reply(chatId, '❌ *Gagal mengecek voucher*\n\n' + esc(err.message), mainKeyboard());
  }
}

function formatVoucherResult(r, successMsg) {
  if (r.success) return '✅ ' + r.voucherCode + ': ' + successMsg;
  if (r.reason === 'not_found') return '🔍 ' + r.voucherCode + ': Voucher tidak ditemukan';
  if (r.reason === 'button_unavailable') return '⚠️ ' + r.voucherCode + ': status ' + r.status;
  return '❌ ' + r.voucherCode + ': ' + (r.message || 'Gagal');
}

async function processExtend(chatId, userId, text, credentials) {
  clearState(userId);
  const parsed = parseCodesAndDate(text);
  if (!parsed) {
    await reply(chatId,
      '❌ *Format tidak valid.*\n\n' +
      'Gunakan: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\n' +
      'Contoh: VOUCHER01, VOUCHER02 | 31-12-2025',
      mainKeyboard()
    );
    return;
  }

  const codes = parsed.codes;
  const date = parsed.date;
  await reply(chatId, '⏳ Memperpanjang ' + codes.length + ' voucher hingga ' + esc(date) + '...\nMohon tunggu.');
  logger.info('Extend ' + codes.length + ' voucher(s) -> ' + date);

  try {
    const { extendVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await extendVoucherCodes(credentials, codes, date);
    const success = results.filter(function(r) { return r.success; });
    const failed  = results.filter(function(r) { return !r.success; });
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    let msg = icon + ' - *Ubah Masa Berlaku Voucher*\n\n';
    msg += '📅 Waktu: ' + new Date().toLocaleString('id-ID') + '\n';
    msg += '📊 Total: ' + results.length + ' | ✅ Berhasil: ' + success.length + ' | ❌ Gagal: ' + failed.length + '\n\n';
    msg += '─────────────────────\n';
    for (let i = 0; i < results.length; i++) {
      msg += esc(formatVoucherResult(results[i], 'Diperpanjang hingga ' + date)) + '\n';
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error('Extend error: ' + err.message);
    await reply(chatId, '❌ *Gagal memUbah Masa Berlaku voucher*\n\n' + esc(err.message), mainKeyboard());
  }
}

async function processDelete(chatId, userId, text, credentials) {
  clearState(userId);
  const parsed = parseCodesAndDate(text);
  if (!parsed) {
    await reply(chatId,
      '❌ *Format tidak valid.*\n\n' +
      'Gunakan: KODE1, KODE2 atau KODE1, KODE2 | DD-MM-YYYY\n' +
      'Contoh: VOUCHER01, VOUCHER02 | 31-12-2025',
      mainKeyboard()
    );
    return;
  }

  const codes = parsed.codes;
  const date = parsed.date;
  await reply(chatId, '⏳ Menghapus ' + codes.length + ' voucher...\nMohon tunggu.');
  logger.info('Delete ' + codes.length + ' voucher(s) | date: ' + date);

  try {
    const { deleteVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await deleteVoucherCodes(credentials, codes, date);
    const success = results.filter(function(r) { return r.success; });
    const failed  = results.filter(function(r) { return !r.success; });
    const icon = failed.length === 0 ? '✅ Selesai' : success.length === 0 ? '❌ Gagal' : '⚠️ Sebagian';

    let msg = icon + ' - *Hapus Voucher*\n\n';
    msg += '📅 Waktu: ' + new Date().toLocaleString('id-ID') + '\n';
    msg += '📊 Total: ' + results.length + ' | ✅ Berhasil: ' + success.length + ' | ❌ Gagal: ' + failed.length + '\n\n';
    msg += '─────────────────────\n';
    for (let i = 0; i < results.length; i++) {
      msg += esc(formatVoucherResult(results[i], 'Berhasil dihapus')) + '\n';
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error('Delete error: ' + err.message);
    await reply(chatId, '❌ *Gagal menghapus voucher*\n\n' + esc(err.message), mainKeyboard());
  }
}

// --- Generate Processor -------------------------------------------------------

async function processGenerate(chatId, userId, text, credentials) {
  if (isProcessing) {
    await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
    return;
  }

  clearState(userId);
  isProcessing = true;
  currentProcess = 'Generate Voucher oleh user ' + userId;

  await reply(chatId, '⚡ *Generating voucher...*\nMohon tunggu.');

  const os = require('os');
  const fs2 = require('fs');
  const baseDir = path.join(os.tmpdir(), 'vgen_' + userId + '_' + Date.now());
  let zipPath = null;

  try {
    const result = await generateVouchers(text, baseDir);
    zipPath = result.zipPath;

    await reply(chatId,
      '✅ *Generate selesai!*\n\n' + result.summary.map(function(s) { return esc(s); }).join('\n') +
      '\n\n🔄 Sedang upload ke ESB ERP...'
    );

    const branchDirs = fs2.readdirSync(baseDir).filter(function(d) {
      return fs2.statSync(path.join(baseDir, d)).isDirectory();
    });

    for (const branchDir of branchDirs) {
      const voucherFolder = path.join(baseDir, branchDir, 'Voucher');
      if (!fs2.existsSync(voucherFolder)) continue;

      const branchKey = resolveBranchKey(branchDir.replace(/-/g, ' '));
      const branchCreds = (branchKey ? getCredentialsForBranch(branchKey) : null) || credentials;
      if (!branchCreds) {
        await reply(chatId, '⚠️ Credentials untuk branch *' + esc(branchDir) + '* tidak ditemukan, dilewati.');
        continue;
      }

      await reply(chatId, '📤 Upload *' + esc(branchDir) + '* ke ESB ERP...');
      try {
        const { voucherUploadOrchestrate } = require(
          path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/orchestrator')
        );
        const results = await voucherUploadOrchestrate({ credentials: branchCreds, folderPath: voucherFolder }, 'CREATE');
        await sendUploadResultNotification(chatId, 'CREATE (' + branchDir + ')', results);

        const failedWithFile = results.filter(function(r) { return !r.status.includes('Success') && r.errorFilePath; });
        for (const r of failedWithFile) {
          await sendErrorFileToTelegram(chatId, r.errorFilePath, r.file);
        }
      } catch (uploadErr) {
        logger.error('Generate upload error [' + branchDir + ']: ' + uploadErr.message);
        await reply(chatId, '⚠️ Upload *' + esc(branchDir) + '* gagal: ' + esc(uploadErr.message));
      }
    }

    await reply(chatId, '📦 Mengirim file hasil generate...');
    await sendDocument(zipPath, chatId, 'Hasil generate voucher');
    await reply(chatId, '✅ *Selesai!* File zip berisi folder/file Excel hasil generate telah dikirim.', mainKeyboard());

  } catch (err) {
    logger.error('Generate error: ' + err.message);
    await reply(chatId, '❌ *Generate gagal*\n\n' + esc(err.message), mainKeyboard());
  } finally {
    try {
      if (fs2.existsSync(baseDir)) fs2.rmSync(baseDir, { recursive: true, force: true });
      if (zipPath && fs2.existsSync(zipPath)) fs2.unlinkSync(zipPath);
    } catch (_) {}
    isProcessing = false;
    currentProcess = null;
  }
}

// --- Document Handler ---------------------------------------------------------

async function handleDocument(chatId, userId, document) {
  const state = getState(userId);

  if (state && state.mode === 'ACTIVATE_CODE') {
    await reply(chatId, '⚠️ Anda memilih opsi input kode voucher. Kirim kode voucher, bukan file Excel.', mainKeyboard());
    return;
  }

  if (state && state.mode === 'BRANCH_SELECT' && (state.pendingMode === 'CREATE' || state.pendingMode === 'ACTIVATE')) {
    const fileName = document.file_name || 'voucher.xlsx';
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      await reply(chatId, '❌ Format tidak didukung. Kirim file .xlsx atau .xls.', mainKeyboard());
      return;
    }
    setState(userId, 'BRANCH_SELECT', {
      pendingMode: state.pendingMode,
      pendingData: state.pendingData,
      pendingFileId: document.file_id,
      pendingFileName: fileName,
    });
    await reply(chatId,
      '📂 File diterima: ' + esc(fileName) + '\n\n🏪 Silakan isi nama branch terlebih dahulu:\n\n' + BRANCH_LIST + '\n\n📝 Kirim nama branch yang sesuai.',
      mainKeyboard()
    );
    return;
  }

  if (!state || (state.mode !== 'CREATE' && state.mode !== 'ACTIVATE')) {
    await reply(chatId, '⚠️ Kirim /create atau /activate terlebih dahulu.', mainKeyboard());
    return;
  }

  const fileName = document.file_name || 'voucher.xlsx';
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    await reply(chatId, '❌ Format tidak didukung. Kirim file .xlsx atau .xls.', mainKeyboard());
    return;
  }
  await processVoucherUpload(chatId, userId, state.mode, document.file_id, fileName, state.credentials);
}

// --- Message Router -----------------------------------------------------------

async function handleMessage(message) {
  const chatId  = message.chat.id;
  const userId  = message.from ? message.from.id : chatId;
  const rawText = message.text ? message.text.trim() : '';
  const cmd     = parseCommand(rawText);

  if (message.document) { await handleDocument(chatId, userId, message.document); return; }

  const state = getState(userId);

  if (state && state.mode === 'BRANCH_SELECT' && rawText && !rawText.startsWith('/')) {
    await handleBranchReply(chatId, userId, rawText, state);
    return;
  }

  if (state && state.mode === 'ACTIVATE_CODE' && rawText && !rawText.startsWith('/')) {
    await processActivateByCode(chatId, userId, rawText, state.credentials);
    return;
  }
  if (state && state.mode === 'ACTIVATE' && rawText && !rawText.startsWith('/')) {
    await reply(chatId, 'Anda memilih opsi aktivasi via file. Kirim file Excel (.xlsx / .xls), bukan kode voucher.', mainKeyboard());
    return;
  }

  if (state && state.mode === 'CHECK' && rawText && !rawText.startsWith('/')) {
    await processVoucherCheck(chatId, userId, rawText, state.credentials);
    return;
  }

  if (state && state.mode === 'EXTEND' && rawText && !rawText.startsWith('/')) {
    await processExtend(chatId, userId, rawText, state.credentials);
    return;
  }
  if (state && state.mode === 'DELETE' && rawText && !rawText.startsWith('/')) {
    await processDelete(chatId, userId, rawText, state.credentials);
    return;
  }

  if (state && state.mode === 'CREATE_GENERATE' && rawText && !rawText.startsWith('/')) {
    await processGenerate(chatId, userId, rawText, state.credentials);
    return;
  }

  if (cmd.startsWith('/extend')) {
    const inlineData = extractInlineData(rawText);
    await askBranch(chatId, userId, 'EXTEND', inlineData);
    return;
  }

  if (cmd.startsWith('/delete')) {
    const inlineData = extractInlineData(rawText);
    await askBranch(chatId, userId, 'DELETE', inlineData);
    return;
  }

  if (cmd === '/start' || cmd === '/menu') await handleStart(chatId);
  else if (cmd === '/create')              await handleCreate(chatId, userId);
  else if (cmd === '/activate')            await handleActivate(chatId, userId);
  else if (cmd === '/check')               await handleCheck(chatId, userId);
  else if (cmd === '/status')              await handleStatus(chatId);
  else if (cmd === '/help')                await handleHelp(chatId);
}

// --- Callback Query Handler ---------------------------------------------------

async function handleCallbackQuery(callbackQuery) {
  const chatId  = callbackQuery.message.chat.id;
  const userId  = callbackQuery.from ? callbackQuery.from.id : chatId;
  const data    = callbackQuery.data || '';
  const queryId = callbackQuery.id;

  try { await answerCallbackQuery(queryId); } catch (_) {}

  if (data === 'create_file') {
    if (isProcessing) {
      await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
      return;
    }
    clearState(userId);
    await askBranch(chatId, userId, 'CREATE');
  } else if (data === 'create_generate') {
    if (isProcessing) {
      await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
      return;
    }
    clearState(userId);
    await sendMessage(
      '⚡ *Generate Voucher*\n\nPilih tipe generate:',
      chatId,
      generateModeKeyboard()
    );
  } else if (data === 'gen_single') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '1️⃣ *Single Mode* — satu file untuk seluruh periode\n\n' +
      '📋 Format:\n`single <branch> [prefix] <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`\n\n' +
      '📝 Contoh:\n`single plb 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_multiple') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '2️⃣ *Multiple Mode* — satu file per tanggal\n\n' +
      '📋 Format:\n`multiple <branch> [prefix] <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`\n\n' +
      '📝 Contoh:\n`multiple ven 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_prefix') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '3️⃣ *Custom Prefix* — tambahkan prefix kustom di dalam tanda kutip sebelum panjang kode\n\n' +
      '📋 Format:\n`single <branch> "PREFIX" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`\n\n' +
      '📝 Contoh:\n`single gom "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple gom "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_custom_branch') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '4️⃣ *Custom Branch* — tentukan branch mana saja yang bisa menggunakan voucher ini\n\n' +
      'Branch ditulis dalam tanda kutip sebagai token kedua setelah mode, pisahkan dengan koma.\n\n' +
      '📋 Format:\n`single "<branch1>, <branch2>" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`\n\n' +
      '📝 Contoh:\n`single "gom, plb" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple "ven, bsb" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_prefix_branch') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '5️⃣ *Custom Prefix + Branch* — gabungan prefix kustom dan custom branch\n\n' +
      'Custom branch di posisi kedua, prefix di posisi ketiga, keduanya dalam tanda kutip.\n\n' +
      '📋 Format:\n`single "<branch1>, <branch2>" "PREFIX" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`\n\n' +
      '📝 Contoh:\n`single "gom, plb" "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple "ven, bsb" "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_multi_amount') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '6️⃣ *Multiple Voucher Amount* — beberapa nominal sekaligus, pisahkan dengan spasi\n\n' +
      '📋 Format:\n`<mode> <branch> <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount1>-<qty1> <amount2>-<qty2> "<notes>"`\n\n' +
      '📝 Contoh:\n`single bsb 30 1 3 - 18 3 2026 0 10000-15 20000-12 "Promo Testing"`\n`multiple bsb 30 1 3 - 18 3 2026 0 10000-15 20000-12 "Promo Testing"`\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'gen_multi_branch') {
    clearState(userId);
    setState(userId, 'CREATE_GENERATE', { credentials: null });
    await reply(chatId,
      '7️⃣ *Multiple Branches* — pisahkan setiap branch dengan ` | `\n\n' +
      '📋 Format:\n`<cmd1> | <cmd2>`\n\n' +
      '📝 Contoh:\n`single ven "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing" | multiple ideo 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n\n' +
      'Credentials di-resolve otomatis per branch dari alias input.\n\n' +
      'Kirim input generate:',
      mainKeyboard()
    );
  } else if (data === 'activate_file') {
    if (isProcessing) {
      await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
      return;
    }
    clearState(userId);
    await askBranch(chatId, userId, 'ACTIVATE');
  } else if (data === 'activate_code') {
    if (isProcessing) {
      await reply(chatId, '⏳ *Proses sedang berjalan*\n\nSaat ini: ' + esc(currentProcess) + '\nMohon tunggu.', mainKeyboard());
      return;
    }
    clearState(userId);
    await askBranch(chatId, userId, 'ACTIVATE_CODE');
  }
}

// --- Polling Loop -------------------------------------------------------------

async function startBot() {
  logger.info('Starting Voucher Bot...');
  if (!isConfigured()) { logger.warn('Telegram not configured. Bot will not start.'); return; }

  const isValid = await validateToken();
  if (!isValid) { logger.warn('Bot token invalid. Bot will not start.'); return; }

  logger.info('Bot ready. Waiting for commands...');

  await setMyCommands([
    { command: 'create',   description: 'Upload voucher baru ke ESB ERP' },
    { command: 'activate', description: 'Aktivasi voucher via file Excel' },
    { command: 'check',    description: 'Cek info voucher by kode' },
    { command: 'extend',   description: 'Perpanjang expired voucher' },
    { command: 'delete',   description: 'Hapus voucher' },
    { command: 'status',   description: 'Status bot' },
    { command: 'help',     description: 'Panduan penggunaan' },
  ]);

  const { sendStartNotification } = require('./notifications');
  await sendStartNotification();

  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
        if (update.callback_query) await handleCallbackQuery(update.callback_query);
      }
    } catch (err) {
      logger.error('Bot loop error: ' + err.message);
      await delay(5000);
    }
  }
}

module.exports = { startBot };
