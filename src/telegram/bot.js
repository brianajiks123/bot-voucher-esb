const path = require('path');
const { sendMessage, getUpdates, validateToken, isConfigured, getBotToken } = require('./telegramClient');
const { sendUploadResultNotification, sendFatalErrorNotification } = require('./notifications');
const { credentials } = require('../config/credentials');
const { createTempFolder, deleteTempFolder, downloadTelegramFile } = require('../utils/tempFiles');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// ─── State Management ─────────────────────────────────────────────────────────

/**
 * Per-user state map: tracks what action the user is waiting to complete (upload or check).
 * Each entry expires after STATE_TTL_MS milliseconds of inactivity.
 */
const userStates = new Map();
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let isProcessing = false;
let currentProcess = null;

function setState(userId, mode) {
  userStates.set(userId, { mode, expiresAt: Date.now() + STATE_TTL_MS });
}

function getState(userId) {
  const state = userStates.get(userId);
  if (!state) return null;
  if (Date.now() > state.expiresAt) {
    userStates.delete(userId);
    return null;
  }
  return state;
}

function clearState(userId) {
  userStates.delete(userId);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reply(chatId, text, replyMarkup = null) {
  return sendMessage(text, chatId, replyMarkup);
}

/**
 * Persistent reply keyboard shown after /start and /help.
 */
function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '/create' }, { text: '/activate' }],
      [{ text: '/check' }, { text: '/status' }],
      [{ text: '/help' }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

// ─── Voucher Upload Processor ─────────────────────────────────────────────────

async function processVoucherUpload(chatId, userId, mode, fileId, fileName) {
  if (isProcessing) {
    await reply(chatId, `Proses sedang berjalan\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }

  isProcessing = true;
  currentProcess = `${mode} oleh user ${userId}`;
  clearState(userId);

  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
  await reply(chatId, `Memproses ${modeLabel}...\n\nFile: ${fileName}\nMohon tunggu beberapa menit.`);

  let tempFolder = null;

  try {
    // Download the file into a unique temp folder per user/mode
    tempFolder = await createTempFolder(userId, mode.toLowerCase());
    await downloadTelegramFile(getBotToken(), fileId, fileName, tempFolder);

    // Load the orchestrator from the sibling project at runtime to avoid circular deps
    const orchestratorPath = path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/orchestrator');
    const { voucherUploadOrchestrate } = require(orchestratorPath);
    const results = await voucherUploadOrchestrate({ credentials, folderPath: tempFolder }, mode);

    await sendUploadResultNotification(chatId, mode, results);
  } catch (err) {
    logger.error(`processVoucherUpload error: ${err.message}`);
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
    `*Voucher Bot - ESB ERP*\n\n` +
    `Pilih command yang ingin dijalankan:\n\n` +
    `/create - Upload voucher baru (CREATE)\n` +
    `/activate - Aktivasi voucher (ACTIVATE)\n` +
    `/check - Cek informasi voucher\n` +
    `/status - Cek status bot\n` +
    `/help - Bantuan penggunaan`,
    mainKeyboard()
  );
}

async function handleCreate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, `Proses sedang berjalan\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }
  setState(userId, 'CREATE');
  await reply(chatId, `Upload Voucher CREATE\n\nSilakan kirim file Excel (.xlsx / .xls) yang berisi data voucher yang akan ditambahkan ke ESB ERP.\n\nSesi ini akan kedaluwarsa dalam 5 menit.`);
}

async function handleActivate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, `Proses sedang berjalan\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }
  setState(userId, 'ACTIVATE');
  await reply(chatId, `Upload Voucher ACTIVATE\n\nSilakan kirim file Excel (.xlsx / .xls) yang berisi data voucher yang akan diaktivasi di ESB ERP.\n\nSesi ini akan kedaluwarsa dalam 5 menit.`);
}

async function handleStatus(chatId) {
  const status = isProcessing ? 'Sedang berjalan' : 'Siap';
  await reply(chatId, `Status Bot\n\nStatus: ${status}\nProses: ${currentProcess || 'Tidak ada'}\nWaktu: ${new Date().toLocaleString('id-ID')}`);
}

async function handleHelp(chatId) {
  await reply(chatId,
    `Bantuan Penggunaan\n\n` +
    `Command:\n` +
    `/create - Mulai proses upload voucher baru\n` +
    `/activate - Mulai proses aktivasi voucher\n` +
    `/check - Cek informasi voucher berdasarkan kode\n` +
    `/status - Cek status bot saat ini\n` +
    `/help - Tampilkan bantuan ini\n\n` +
    `Cara penggunaan:\n` +
    `1. Kirim /create atau /activate\n` +
    `2. Bot akan meminta file Excel\n` +
    `3. Kirim file .xlsx atau .xls\n` +
    `4. Bot akan memproses dan mengirim hasilnya\n\n` +
    `Cek Voucher:\n` +
    `1. Kirim /check\n` +
    `2. Kirim kode voucher (pisahkan dengan koma jika lebih dari satu)\n` +
    `3. Bot akan menampilkan detail voucher\n\n` +
    `Catatan:\n` +
    `- Hanya 1 proses yang bisa berjalan bersamaan\n` +
    `- Sesi upload kedaluwarsa dalam 5 menit\n` +
    `- File akan otomatis dihapus setelah diproses`,
    mainKeyboard()
  );
}

async function handleCheck(chatId, userId) {
  setState(userId, 'CHECK');
  await reply(chatId, `Cek Voucher\n\nSilakan kirim kode voucher yang ingin dicek.\nJika lebih dari satu, pisahkan dengan koma.\n\nContoh: VOUCHER01, VOUCHER02\n\nSesi ini akan kedaluwarsa dalam 5 menit.`);
}

// ─── Voucher Check Processor ──────────────────────────────────────────────────

async function processVoucherCheck(chatId, userId, text) {
  clearState(userId);
  const codes = text.split(',').map((c) => c.trim()).filter(Boolean);

  if (codes.length === 0) {
    await reply(chatId, 'Kode voucher tidak valid.');
    return;
  }

  await reply(chatId, `Mencari ${codes.length} voucher...\nMohon tunggu.`);

  try {
    // Load esbServices from the sibling project at runtime
    const esbServicesPath = path.resolve(__dirname, '../../../esb-voucher-upload-activation/src/core/esbServices');
    const { checkVoucherCodes } = require(esbServicesPath);
    const results = await checkVoucherCodes(credentials, codes);

    for (const r of results) {
      if (!r.found) {
        await reply(chatId, `${r.voucherCode}\nVoucher tidak ditemukan.`);
        continue;
      }
      const d = r.data;
      await reply(chatId,
        `${d.voucherCode}\n\n` +
        `Branch: ${d.branch}\n` +
        `Start Date: ${d.startDate}\n` +
        `End Date: ${d.endDate}\n` +
        `Min. Sales Amount: ${d.minSalesAmount}\n` +
        `Voucher Amount: ${d.voucherAmount}\n` +
        `Voucher Sales Price: ${d.voucherSalesPrice}\n` +
        `Additional Info: ${d.additionalInfo}\n` +
        `Status: ${d.status}`
      );
    }
  } catch (err) {
    logger.error(`processVoucherCheck error: ${err.message}`);
    await reply(chatId, `Gagal mengecek voucher\n\n${err.message}`);
  }
}

// ─── Document Handler ─────────────────────────────────────────────────────────

async function handleDocument(chatId, userId, document) {
  const state = getState(userId);

  if (!state) {
    await reply(chatId, 'Kirim /create atau /activate terlebih dahulu sebelum mengirim file.');
    return;
  }

  const fileName = document.file_name || 'voucher.xlsx';
  const isExcel = /\.(xlsx|xls)$/i.test(fileName);

  if (!isExcel) {
    await reply(chatId, 'Format file tidak didukung\n\nHanya file Excel (.xlsx atau .xls) yang diterima.\nSilakan kirim ulang dengan file yang benar.');
    return;
  }

  await processVoucherUpload(chatId, userId, state.mode, document.file_id, fileName);
}

// ─── Message Router ───────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId  = message.chat.id;
  const userId  = message.from?.id || chatId;
  const text    = message.text?.toLowerCase().trim() || '';
  const rawText = message.text?.trim() || '';

  if (message.document) {
    await handleDocument(chatId, userId, message.document);
    return;
  }

  // If user is in CHECK state and sends plain text (not a command), treat it as voucher codes
  const state = getState(userId);
  if (state?.mode === 'CHECK' && rawText && !rawText.startsWith('/')) {
    await processVoucherCheck(chatId, userId, rawText);
    return;
  }

  if (text === '/start' || text === '/menu') await handleStart(chatId);
  else if (text === '/create')               await handleCreate(chatId, userId);
  else if (text === '/activate')             await handleActivate(chatId, userId);
  else if (text === '/check')                await handleCheck(chatId, userId);
  else if (text === '/status')               await handleStatus(chatId);
  else if (text === '/help')                 await handleHelp(chatId);
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────

async function startBot() {
  logger.info('Starting Voucher Bot...');

  if (!isConfigured()) {
    logger.warn('Telegram is not configured. Bot will not start.');
    return;
  }

  const isValid = await validateToken();
  if (!isValid) {
    logger.warn('Bot token is invalid. Bot will not start.');
    return;
  }

  logger.info('Voucher Bot is ready. Waiting for commands...');
  let offset = 0;

  while (true) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
      }
    } catch (err) {
      logger.error(`Bot loop error: ${err.message}`);
      await delay(5000);
    }
  }
}

module.exports = { startBot };
