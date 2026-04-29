const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../../utils/logger');
const { reply, esc } = require('../helpers');
const { setState, clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { acquireLock, releaseLock, getLockState } = require('../processingState');
const { sendUploadResultNotification, sendErrorFileToTelegram } = require('../notifications');
const { sendDocument } = require('../telegramClient');
const { generateVouchers } = require('../../voucher/generator');
const { resolveBranchKey, getCredentialsForBranch } = require('../../config/credentials');

const CONFIRM_TTL_MS = 2 * 60 * 1000; // 2 minutes confirmation

const confirmTimers = new Map();

function cleanupGenerateTempFiles(baseDir, zipPath) {
  try {
    if (baseDir && fs.existsSync(baseDir)) fs.rmSync(baseDir, { recursive: true, force: true });
    if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  } catch (_) {}
}

function cancelConfirmTimer(userId) {
  const timer = confirmTimers.get(userId);
  if (timer) { clearTimeout(timer); confirmTimers.delete(userId); }
}

function scheduleConfirmTimeout(chatId, userId, baseDir, zipPath) {
  cancelConfirmTimer(userId);
  const timer = setTimeout(() => {
    confirmTimers.delete(userId);
    clearState(userId);
    cleanupGenerateTempFiles(baseDir, zipPath);
    logger.info(`Generate confirm timeout for user ${userId}, temp files cleaned up.`);
    reply(chatId, '⏱️ Waktu konfirmasi habis. Upload dibatalkan dan file temp telah dihapus.', mainKeyboard());
  }, CONFIRM_TTL_MS);
  confirmTimers.set(userId, timer);
}

async function uploadGenerateResults(chatId, baseDir, credentials) {
  const branchDirs = fs.readdirSync(baseDir).filter((d) =>
    fs.statSync(path.join(baseDir, d)).isDirectory()
  );

  for (const branchDir of branchDirs) {
    const voucherFolder = path.join(baseDir, branchDir, 'Voucher');
    if (!fs.existsSync(voucherFolder)) continue;

    const branchKey   = resolveBranchKey(branchDir.replace(/-/g, ' '));
    const branchCreds = (branchKey ? getCredentialsForBranch(branchKey) : null) || credentials;
    if (!branchCreds) {
      await reply(chatId, `⚠️ Credentials untuk branch *${esc(branchDir)}* tidak ditemukan, dilewati.`);
      continue;
    }

    await reply(chatId, `📤 Upload *${esc(branchDir)}* ke ESB ERP...`);
    try {
      const { voucherUploadOrchestrate } = require(
        path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/orchestrator')
      );
      const results = await voucherUploadOrchestrate({ credentials: branchCreds, folderPath: voucherFolder }, 'CREATE');
      await sendUploadResultNotification(chatId, `CREATE (${branchDir})`, results);

      const failedWithFile = results.filter((r) => !r.status.includes('Success') && r.errorFilePath);
      for (const r of failedWithFile) {
        await sendErrorFileToTelegram(chatId, r.errorFilePath, r.file);
      }
    } catch (uploadErr) {
      logger.error(`Generate upload error [${branchDir}]: ${uploadErr.message}`);
      await reply(chatId, `⚠️ Upload *${esc(branchDir)}* gagal: ${esc(uploadErr.message)}`);
    }
  }
}

async function processGenerate(chatId, userId, text, credentials, allowPrefix = false) {
  const { isProcessing, currentProcess } = getLockState();
  if (isProcessing) {
    await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
    return;
  }

  clearState(userId);
  acquireLock(`Generate Voucher oleh user ${userId}`);
  await reply(chatId, '⚡ *Generating voucher...*\nMohon tunggu.');

  const baseDir = path.join(os.tmpdir(), `vgen_${userId}_${Date.now()}`);
  let zipPath = null;

  try {
    const result = await generateVouchers(text, baseDir, allowPrefix);
    zipPath = result.zipPath;

    await reply(chatId,
      `✅ *Generate selesai!*\n\n${result.summary.map((s) => esc(s)).join('\n')}\n\n` +
      `📁 File ZIP berisi:\n` +
      `  • Folder *Voucher/* — untuk upload via /create\n` +
      `  • Folder *Activation/* — untuk aktivasi via /activate\n\n` +
      `📦 Mengirim file hasil generate...`
    );
    await sendDocument(zipPath, chatId, 'Hasil generate voucher');

    setState(userId, 'GENERATE_CONFIRM', { baseDir, zipPath, credentials }, CONFIRM_TTL_MS);
    scheduleConfirmTimeout(chatId, userId, baseDir, zipPath);

    await reply(chatId,
      '❓ *Upload Voucher ke ESB ERP?*\n\n' +
      'File *Voucher/* akan diupload ke ESB ERP sekarang.\n' +
      'File *Activation/* disimpan di ZIP untuk digunakan nanti via /activate.\n\n' +
      'Balas *ya* untuk upload atau *tidak* untuk lewati.\n' +
      '⏱️ Konfirmasi kedaluwarsa dalam 2 menit.',
      mainKeyboard()
    );
  } catch (err) {
    logger.error(`Generate error: ${err.message}`);
    await reply(chatId, `❌ *Generate gagal*\n\n${esc(err.message)}`, mainKeyboard());
    cleanupGenerateTempFiles(baseDir, zipPath);
  } finally {
    releaseLock();
  }
}

async function handleGenerateConfirm(chatId, userId, text, state) {
  cancelConfirmTimer(userId);
  clearState(userId);
  const { baseDir, zipPath, credentials } = state;
  const answer = text.trim().toLowerCase();

  if (answer === 'ya' || answer === 'yes') {
    const { isProcessing, currentProcess } = getLockState();
    if (isProcessing) {
      await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
      cleanupGenerateTempFiles(baseDir, zipPath);
      return;
    }

    acquireLock(`Upload Generate oleh user ${userId}`);
    await reply(chatId, '🔄 Sedang upload ke ESB ERP...\nMohon tunggu beberapa menit.');
    try {
      await uploadGenerateResults(chatId, baseDir, credentials);
      await reply(chatId, '✅ *Upload selesai!*', mainKeyboard());
    } catch (err) {
      logger.error(`Generate confirm upload error: ${err.message}`);
      await reply(chatId, `❌ *Upload gagal*\n\n${esc(err.message)}`, mainKeyboard());
    } finally {
      cleanupGenerateTempFiles(baseDir, zipPath);
      releaseLock();
    }
  } else if (answer === 'tidak' || answer === 'no') {
    cleanupGenerateTempFiles(baseDir, zipPath);
    await reply(chatId, '✅ Upload dilewati. File temp telah dihapus.', mainKeyboard());
  } else {
    const remaining = state.expiresAt - Date.now();
    if (remaining > 0) {
      setState(userId, 'GENERATE_CONFIRM', { baseDir, zipPath, credentials }, remaining);
      scheduleConfirmTimeout(chatId, userId, baseDir, zipPath);
      await reply(chatId, '❓ Balas *ya* untuk upload ke ESB ERP atau *tidak* untuk lewati.');
    } else {
      cleanupGenerateTempFiles(baseDir, zipPath);
      await reply(chatId, '⏱️ Waktu konfirmasi habis. Upload dibatalkan dan file temp telah dihapus.', mainKeyboard());
    }
  }
}

module.exports = { processGenerate, handleGenerateConfirm };
