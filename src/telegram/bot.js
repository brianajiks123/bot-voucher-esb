/**
 * bot.js
 * Core bot logic: polling loop, command handlers, state management, flow processors.
 */

const path = require('path');
const { sendMessage, getUpdates, validateToken, isConfigured, getBotToken, setMyCommands } = require('./telegramClient');
const { sendUploadResultNotification, sendFatalErrorNotification } = require('./notifications');
const { mainKeyboard } = require('./keyboard');
const { credentials } = require('../config/credentials');
const { createTempFolder, deleteTempFolder, downloadTelegramFile } = require('../utils/tempFiles');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// Per-user state. Modes: CREATE | ACTIVATE | CHECK | EXTEND | DELETE. Expires after 5 minutes.
const userStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000;

let isProcessing = false;
let currentProcess = null;

function setState(userId, mode) {
  userStates.set(userId, { mode, expiresAt: Date.now() + STATE_TTL_MS });
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

// Strip @botname suffix so commands work in groups
function parseCommand(text) {
  return text ? text.trim().toLowerCase().replace(/@\S+$/, '') : '';
}

// Parse "CODE1, CODE2 | DD-MM-YYYY" format, returns { codes, date } or null
function parseCodesAndDate(text) {
  const parts = text.split('|');
  if (parts.length !== 2) return null;
  const codes = parts[0].split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  const date  = parts[1].trim();
  if (codes.length === 0) return null;
  const match = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const dd = match[1], mm = match[2], yyyy = match[3];
  if (isNaN(new Date(yyyy + '-' + mm + '-' + dd).getTime())) return null;
  return { codes: codes, date: date };
}

// Extract inline data after command, e.g. "/extend KODE | DATE" -> "KODE | DATE"
function extractInlineData(rawText) {
  const spaceIdx = rawText.indexOf(' ');
  if (spaceIdx === -1) return null;
  const data = rawText.slice(spaceIdx + 1).trim();
  return data.length > 0 ? data : null;
}

// ─── Upload Processor ─────────────────────────────────────────────────────────

async function processVoucherUpload(chatId, userId, mode, fileId, fileName) {
  if (isProcessing) {
    await reply(chatId, 'Proses sedang berjalan\n\nSaat ini: ' + currentProcess + '\nMohon tunggu.', mainKeyboard());
    return;
  }

  isProcessing = true;
  currentProcess = mode + ' oleh user ' + userId;
  clearState(userId);

  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
  await reply(chatId, 'File diterima: ' + fileName + '\nSedang memproses ' + modeLabel + '...');

  let tempFolder = null;
  try {
    tempFolder = await createTempFolder(userId, mode.toLowerCase());
    await downloadTelegramFile(getBotToken(), fileId, fileName, tempFolder);

    await reply(chatId, 'Sedang upload ke ESB ERP...\nMohon tunggu beberapa menit.');

    const { voucherUploadOrchestrate } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/orchestrator')
    );
    const results = await voucherUploadOrchestrate({ credentials: credentials, folderPath: tempFolder }, mode);
    await sendUploadResultNotification(chatId, mode, results);
  } catch (err) {
    logger.error('Upload [' + mode + '] error: ' + err.message);
    await sendFatalErrorNotification(chatId, mode, err.message);
  } finally {
    if (tempFolder) await deleteTempFolder(tempFolder);
    isProcessing = false;
    currentProcess = null;
  }
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleStart(chatId) {
  await reply(chatId,
    '*Voucher Bot - ESB ERP*\n\n' +
    'Pilih command:\n\n' +
    '/create - Upload voucher baru\n' +
    '/activate - Aktivasi voucher\n' +
    '/check - Cek info voucher\n' +
    '/extend - Perpanjang expired voucher\n' +
    '/delete - Hapus voucher\n' +
    '/status - Status bot\n' +
    '/help - Panduan penggunaan',
    mainKeyboard()
  );
}

async function handleCreate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, 'Proses sedang berjalan\n\nSaat ini: ' + currentProcess + '\nMohon tunggu.', mainKeyboard());
    return;
  }
  setState(userId, 'CREATE');
  await reply(chatId, 'Upload Voucher CREATE\n\nKirim file Excel (.xlsx / .xls) berisi data voucher.\n\nSesi kedaluwarsa dalam 5 menit.', mainKeyboard());
}

async function handleActivate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, 'Proses sedang berjalan\n\nSaat ini: ' + currentProcess + '\nMohon tunggu.', mainKeyboard());
    return;
  }
  setState(userId, 'ACTIVATE');
  await reply(chatId, 'Upload Voucher ACTIVATE\n\nKirim file Excel (.xlsx / .xls) berisi data voucher yang akan diaktivasi.\n\nSesi kedaluwarsa dalam 5 menit.', mainKeyboard());
}

async function handleStatus(chatId) {
  const status = isProcessing ? 'Sedang berjalan' : 'Siap';
  await reply(chatId, 'Status Bot\n\nStatus: ' + status + '\nProses: ' + (currentProcess || '-') + '\nWaktu: ' + new Date().toLocaleString('id-ID'), mainKeyboard());
}

async function handleHelp(chatId) {
  await reply(chatId,
    'Panduan Penggunaan\n\n' +
    'Upload Voucher:\n' +
    '1. Kirim /create atau /activate\n' +
    '2. Kirim file .xlsx atau .xls\n' +
    '3. Bot memproses dan mengirim hasilnya\n\n' +
    'Cek Voucher:\n' +
    '1. Kirim /check\n' +
    '2. Kirim kode voucher (pisah koma jika lebih dari satu)\n\n' +
    'Perpanjang Voucher (2 cara):\n' +
    'a. Inline: /extend KODE1, KODE2 | DD-MM-YYYY\n' +
    'b. Dua langkah: kirim /extend, lalu kirim KODE1, KODE2 | DD-MM-YYYY\n' +
    '   Contoh: VOUCHER01, VOUCHER02 | 31-12-2025\n\n' +
    'Hapus Voucher (2 cara):\n' +
    'a. Inline: /delete KODE1, KODE2 | DD-MM-YYYY\n' +
    'b. Dua langkah: kirim /delete, lalu kirim KODE1, KODE2 | DD-MM-YYYY\n' +
    '   Contoh: VOUCHER01, VOUCHER02 | 31-12-2025\n\n' +
    'Catatan:\n' +
    '- Hanya 1 proses berjalan bersamaan\n' +
    '- Sesi /check, /extend, /delete kedaluwarsa dalam 5 menit\n' +
    '- File dihapus otomatis setelah diproses',
    mainKeyboard()
  );
}

async function handleCheck(chatId, userId) {
  setState(userId, 'CHECK');
  await reply(chatId, 'Cek Voucher\n\nKirim kode voucher. Pisahkan dengan koma jika lebih dari satu.\n\nContoh: VOUCHER01, VOUCHER02\n\nSesi kedaluwarsa dalam 5 menit.', mainKeyboard());
}

async function handleExtend(chatId) {
  await reply(chatId,
    'Perpanjang Voucher\n\n' +
    'Kirim dalam format:\n' +
    'KODE1, KODE2 | DD-MM-YYYY\n\n' +
    'Contoh:\n' +
    'VOUCHER01, VOUCHER02 | 31-12-2025',
    mainKeyboard()
  );
}

async function handleDelete(chatId) {
  await reply(chatId,
    'Hapus Voucher\n\n' +
    'Kirim dalam format:\n' +
    'KODE1, KODE2 | DD-MM-YYYY\n\n' +
    'Contoh:\n' +
    'VOUCHER01, VOUCHER02 | 31-12-2025',
    mainKeyboard()
  );
}

// ─── Flow Processors ──────────────────────────────────────────────────────────

async function processVoucherCheck(chatId, userId, text) {
  clearState(userId);
  const codes = text.split(',').map(function(c) { return c.trim(); }).filter(Boolean);
  if (codes.length === 0) { await reply(chatId, 'Kode voucher tidak valid.', mainKeyboard()); return; }

  await reply(chatId, 'Mencari ' + codes.length + ' voucher...\nMohon tunggu.');
  try {
    const { checkVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await checkVoucherCodes(credentials, codes);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isLast = i === results.length - 1;
      const kb = isLast ? mainKeyboard() : null;
      if (!r.found) { await reply(chatId, r.voucherCode + '\nVoucher tidak ditemukan.', kb); continue; }
      const d = r.data;
      await reply(chatId,
        d.voucherCode + '\n\n' +
        'Branch: ' + d.branch + '\n' +
        'Start Date: ' + d.startDate + '\n' +
        'End Date: ' + d.endDate + '\n' +
        'Min. Sales Amount: ' + d.minSalesAmount + '\n' +
        'Voucher Amount: ' + d.voucherAmount + '\n' +
        'Voucher Sales Price: ' + d.voucherSalesPrice + '\n' +
        'Additional Info: ' + d.additionalInfo + '\n' +
        'Status: ' + d.status,
        kb
      );
    }
  } catch (err) {
    logger.error('Check voucher error: ' + err.message);
    await reply(chatId, 'Gagal mengecek voucher\n\n' + err.message, mainKeyboard());
  }
}

// Format per-voucher result for extend/delete summary
function formatVoucherResult(r, successMsg) {
  if (r.success) return 'OK ' + r.voucherCode + ': ' + successMsg;
  if (r.reason === 'not_found') return 'TIDAK DITEMUKAN ' + r.voucherCode + ': Voucher tidak ditemukan';
  if (r.reason === 'button_unavailable') return 'TIDAK DAPAT DIPROSES ' + r.voucherCode + ': status ' + r.status;
  return 'GAGAL ' + r.voucherCode + ': ' + (r.message || 'Gagal');
}

async function processExtend(chatId, userId, text) {
  clearState(userId);
  const parsed = parseCodesAndDate(text);
  if (!parsed) {
    await reply(chatId,
      'Format tidak valid.\n\n' +
      'Gunakan: KODE1, KODE2 | DD-MM-YYYY\n' +
      'Contoh: VOUCHER01, VOUCHER02 | 31-12-2025',
      mainKeyboard()
    );
    return;
  }

  const codes = parsed.codes;
  const date = parsed.date;
  await reply(chatId, 'Memperpanjang ' + codes.length + ' voucher hingga ' + date + '...\nMohon tunggu.');
  logger.info('Extend ' + codes.length + ' voucher(s) -> ' + date);

  try {
    const { extendVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await extendVoucherCodes(credentials, codes, date);
    const success = results.filter(function(r) { return r.success; });
    const failed  = results.filter(function(r) { return !r.success; });
    const icon = failed.length === 0 ? 'Selesai' : success.length === 0 ? 'Gagal' : 'Sebagian';

    let msg = icon + ' - Perpanjang Voucher\n\n';
    msg += 'Waktu: ' + new Date().toLocaleString('id-ID') + '\n';
    msg += 'Total: ' + results.length + ' | Berhasil: ' + success.length + ' | Gagal: ' + failed.length + '\n\n';
    msg += '─────────────────────\n';
    for (let i = 0; i < results.length; i++) {
      msg += formatVoucherResult(results[i], 'Diperpanjang hingga ' + date) + '\n';
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error('Extend error: ' + err.message);
    await reply(chatId, 'Gagal memperpanjang voucher\n\n' + err.message, mainKeyboard());
  }
}

async function processDelete(chatId, userId, text) {
  clearState(userId);
  const parsed = parseCodesAndDate(text);
  if (!parsed) {
    await reply(chatId,
      'Format tidak valid.\n\n' +
      'Gunakan: KODE1, KODE2 | DD-MM-YYYY\n' +
      'Contoh: VOUCHER01, VOUCHER02 | 31-12-2025',
      mainKeyboard()
    );
    return;
  }

  const codes = parsed.codes;
  const date = parsed.date;
  await reply(chatId, 'Menghapus ' + codes.length + ' voucher...\nMohon tunggu.');
  logger.info('Delete ' + codes.length + ' voucher(s) | date: ' + date);

  try {
    const { deleteVoucherCodes } = require(
      path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices')
    );
    const results = await deleteVoucherCodes(credentials, codes, date);
    const success = results.filter(function(r) { return r.success; });
    const failed  = results.filter(function(r) { return !r.success; });
    const icon = failed.length === 0 ? 'Selesai' : success.length === 0 ? 'Gagal' : 'Sebagian';

    let msg = icon + ' - Hapus Voucher\n\n';
    msg += 'Waktu: ' + new Date().toLocaleString('id-ID') + '\n';
    msg += 'Total: ' + results.length + ' | Berhasil: ' + success.length + ' | Gagal: ' + failed.length + '\n\n';
    msg += '─────────────────────\n';
    for (let i = 0; i < results.length; i++) {
      msg += formatVoucherResult(results[i], 'Berhasil dihapus') + '\n';
    }
    await reply(chatId, msg.trim(), mainKeyboard());
  } catch (err) {
    logger.error('Delete error: ' + err.message);
    await reply(chatId, 'Gagal menghapus voucher\n\n' + err.message, mainKeyboard());
  }
}

// ─── Document Handler ─────────────────────────────────────────────────────────

async function handleDocument(chatId, userId, document) {
  const state = getState(userId);
  if (!state) { await reply(chatId, 'Kirim /create atau /activate terlebih dahulu.', mainKeyboard()); return; }

  const fileName = document.file_name || 'voucher.xlsx';
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    await reply(chatId, 'Format tidak didukung. Kirim file .xlsx atau .xls.', mainKeyboard());
    return;
  }
  await processVoucherUpload(chatId, userId, state.mode, document.file_id, fileName);
}

// ─── Message Router ───────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId  = message.chat.id;
  const userId  = message.from ? message.from.id : chatId;
  const rawText = message.text ? message.text.trim() : '';
  const cmd     = parseCommand(rawText);

  if (message.document) { await handleDocument(chatId, userId, message.document); return; }

  const state = getState(userId);

  // CHECK flow
  if (state && state.mode === 'CHECK' && rawText && !rawText.startsWith('/')) {
    await processVoucherCheck(chatId, userId, rawText);
    return;
  }

  // EXTEND / DELETE two-step flow
  if (rawText && rawText.includes('|') && !rawText.startsWith('/')) {
    if (state && state.mode === 'EXTEND') { await processExtend(chatId, userId, rawText); return; }
    if (state && state.mode === 'DELETE') { await processDelete(chatId, userId, rawText); return; }
  }

  // EXTEND inline: /extend CODE1, CODE2 | DD-MM-YYYY
  if (cmd.startsWith('/extend')) {
    const inlineData = extractInlineData(rawText);
    if (inlineData && inlineData.includes('|')) {
      await processExtend(chatId, userId, inlineData);
    } else {
      setState(userId, 'EXTEND');
      await handleExtend(chatId);
    }
    return;
  }

  // DELETE inline: /delete CODE1, CODE2 | DD-MM-YYYY
  if (cmd.startsWith('/delete')) {
    const inlineData = extractInlineData(rawText);
    if (inlineData && inlineData.includes('|')) {
      await processDelete(chatId, userId, inlineData);
    } else {
      setState(userId, 'DELETE');
      await handleDelete(chatId);
    }
    return;
  }

  if (cmd === '/start' || cmd === '/menu') await handleStart(chatId);
  else if (cmd === '/create')              await handleCreate(chatId, userId);
  else if (cmd === '/activate')            await handleActivate(chatId, userId);
  else if (cmd === '/check')               await handleCheck(chatId, userId);
  else if (cmd === '/status')              await handleStatus(chatId);
  else if (cmd === '/help')                await handleHelp(chatId);
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────

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
      }
    } catch (err) {
      logger.error('Bot loop error: ' + err.message);
      await delay(5000);
    }
  }
}

module.exports = { startBot };