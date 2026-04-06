const path = require('path');
const logger = require('../../utils/logger');
const { reply, esc } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { acquireLock, releaseLock, getLockState } = require('../processingState');
const { createTempFolder, deleteTempFolder, downloadTelegramFile } = require('../../utils/tempFiles');
const { sendUploadResultNotification, sendFatalErrorNotification, sendErrorFileToTelegram } = require('../notifications');
const { getBotToken } = require('../telegramClient');

async function processVoucherUpload(chatId, userId, mode, fileId, fileName, credentials) {
  const { isProcessing, currentProcess } = getLockState();
  if (isProcessing) {
    await reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());
    return;
  }

  acquireLock(`${mode} oleh user ${userId}`);
  clearState(userId);

  const modeLabel = mode === 'CREATE' ? 'Create Voucher' : 'Activate Voucher';
  await reply(chatId, `📂 File diterima: ${esc(fileName)}\n⏳ Sedang memproses ${esc(modeLabel)}...`);

  let tempFolder = null;
  try {
    tempFolder = await createTempFolder(userId, mode.toLowerCase());
    await downloadTelegramFile(getBotToken(), fileId, fileName, tempFolder);

    await reply(chatId, '🔄 Sedang upload ke ESB ERP...\nMohon tunggu beberapa menit.');

    const { voucherUploadOrchestrate } = require(
      path.resolve(__dirname, '../../../../esb-voucher-upload-activation/src/core/orchestrator')
    );
    const results = await voucherUploadOrchestrate({ credentials, folderPath: tempFolder }, mode);
    await sendUploadResultNotification(chatId, mode, results);

    const failedWithFile = results.filter((r) => !r.status.includes('Success') && r.errorFilePath);
    for (const r of failedWithFile) {
      await sendErrorFileToTelegram(chatId, r.errorFilePath, r.file);
    }
  } catch (err) {
    logger.error(`Upload [${mode}] error: ${err.message}`);
    await sendFatalErrorNotification(chatId, mode, err.message);
    if (err.errorFilePath) {
      await sendErrorFileToTelegram(chatId, err.errorFilePath, fileName);
    }
  } finally {
    if (tempFolder) await deleteTempFolder(tempFolder);
    releaseLock();
  }
}

module.exports = { processVoucherUpload };
