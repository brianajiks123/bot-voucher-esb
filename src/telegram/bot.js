const path = require('path');
const { sendMessage, answerCallbackQuery, getUpdates, validateToken, isConfigured, getBotToken } = require('./telegramClient');
const { sendUploadResultNotification, sendFatalErrorNotification } = require('./notifications');
const { credentials } = require('../config/credentials');
const { createTempFolder, deleteTempFolder, downloadTelegramFile } = require('../utils/tempFiles');
const logger = require('../utils/logger');
const { delay } = require('../utils/delay');

// ─── State Management ─────────────────────────────────────────────────────────

/**
 * Tracks per-user state: waiting for file upload
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

// ─── Voucher Processor ────────────────────────────────────────────────────────

async function processVoucherUpload(chatId, userId, mode, fileId, fileName) {
  if (isProcessing) {
    await reply(chatId, `⚠️ *Proses sedang berjalan*\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }

  isProcessing = true;
  currentProcess = `${mode} oleh user ${userId}`;
  clearState(userId);

  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
  await reply(chatId, `🔄 *Memproses ${modeLabel}...*\n\nFile: \`${fileName}\`\nMohon tunggu beberapa menit.`);

  let tempFolder = null;

  try {
    // Download file to unique temp folder
    tempFolder = await createTempFolder(userId, mode.toLowerCase());
    await downloadTelegramFile(getBotToken(), fileId, fileName, tempFolder);

    // Require orchestrator from voucher-upload-activation-esb (sibling project)
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
  await reply(chatId, `🤖 *Voucher Bot - ESB ERP*

Pilih command yang ingin dijalankan:

/create — Upload voucher baru (CREATE)
/activate — Aktivasi voucher (ACTIVATE)
/status — Cek status bot
/help — Bantuan penggunaan`);
}

async function handleCreate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, `⚠️ *Proses sedang berjalan*\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }
  setState(userId, 'CREATE');
  await reply(chatId, `📤 *Upload Voucher CREATE*\n\nSilakan kirim file Excel (.xlsx / .xls) yang berisi data voucher yang akan ditambahkan ke ESB ERP.\n\n⏳ Sesi ini akan kedaluwarsa dalam 5 menit.`);
}

async function handleActivate(chatId, userId) {
  if (isProcessing) {
    await reply(chatId, `⚠️ *Proses sedang berjalan*\n\nSaat ini: ${currentProcess}\nMohon tunggu hingga selesai.`);
    return;
  }
  setState(userId, 'ACTIVATE');
  await reply(chatId, `📤 *Upload Voucher ACTIVATE*\n\nSilakan kirim file Excel (.xlsx / .xls) yang berisi data voucher yang akan diaktivasi di ESB ERP.\n\n⏳ Sesi ini akan kedaluwarsa dalam 5 menit.`);
}

async function handleStatus(chatId) {
  const status = isProcessing ? '🔄 Sedang berjalan' : '✅ Siap';
  await reply(chatId, `📊 *Status Bot*\n\nStatus: ${status}\nProses: ${currentProcess || 'Tidak ada'}\nWaktu: ${new Date().toLocaleString('id-ID')}`);
}

async function handleHelp(chatId) {
  await reply(chatId, `❓ *Bantuan Penggunaan*

*Command:*
/create — Mulai proses upload voucher baru
/activate — Mulai proses aktivasi voucher
/status — Cek status bot saat ini
/help — Tampilkan bantuan ini

*Cara penggunaan:*
1. Kirim /create atau /activate
2. Bot akan meminta file Excel
3. Kirim file .xlsx atau .xls
4. Bot akan memproses dan mengirim hasilnya

*Catatan:*
• Hanya 1 proses yang bisa berjalan bersamaan
• Sesi upload kedaluwarsa dalam 5 menit
• File akan otomatis dihapus setelah diproses`);
}

// ─── Document Handler ─────────────────────────────────────────────────────────

async function handleDocument(chatId, userId, document) {
  const state = getState(userId);

  if (!state) {
    await reply(chatId, `ℹ️ Kirim /create atau /activate terlebih dahulu sebelum mengirim file.`);
    return;
  }

  const fileName = document.file_name || 'voucher.xlsx';
  const isExcel = /\.(xlsx|xls)$/i.test(fileName);

  if (!isExcel) {
    await reply(chatId, `❌ *Format file tidak didukung*\n\nHanya file Excel (.xlsx atau .xls) yang diterima.\nSilakan kirim ulang dengan file yang benar.`);
    return;
  }

  await processVoucherUpload(chatId, userId, state.mode, document.file_id, fileName);
}

// ─── Message Router ───────────────────────────────────────────────────────────

async function handleMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id || chatId;
  const text   = message.text?.toLowerCase().trim() || '';

  if (message.document) {
    await handleDocument(chatId, userId, message.document);
    return;
  }

  if (text === '/start' || text === '/menu') await handleStart(chatId);
  else if (text === '/create')               await handleCreate(chatId, userId);
  else if (text === '/activate')             await handleActivate(chatId, userId);
  else if (text === '/status')               await handleStatus(chatId);
  else if (text === '/help')                 await handleHelp(chatId);
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────

async function startBot() {
  logger.info('Starting Voucher Bot...');

  if (!isConfigured()) {
    logger.warn('Telegram tidak dikonfigurasi. Bot tidak berjalan.');
    return;
  }

  const isValid = await validateToken();
  if (!isValid) {
    logger.warn('Bot token tidak valid. Bot tidak berjalan.');
    return;
  }

  logger.info('Voucher Bot siap. Menunggu perintah...');
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
