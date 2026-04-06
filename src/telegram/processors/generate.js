const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../../utils/logger');
const { reply, esc } = require('../helpers');
const { clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { acquireLock, releaseLock, getLockState } = require('../processingState');
const { sendUploadResultNotification, sendErrorFileToTelegram } = require('../notifications');
const { sendDocument } = require('../telegramClient');
const { generateVouchers } = require('../../voucher/generator');
const { resolveBranchKey, getCredentialsForBranch } = require('../../config/credentials');

async function processGenerate(chatId, userId, text, credentials) {
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
    const result = await generateVouchers(text, baseDir);
    zipPath = result.zipPath;

    await reply(chatId,
      `✅ *Generate selesai!*\n\n${result.summary.map((s) => esc(s)).join('\n')}\n\n🔄 Sedang upload ke ESB ERP...`
    );

    const branchDirs = fs.readdirSync(baseDir).filter((d) =>
      fs.statSync(path.join(baseDir, d)).isDirectory()
    );

    for (const branchDir of branchDirs) {
      const voucherFolder = path.join(baseDir, branchDir, 'Voucher');
      if (!fs.existsSync(voucherFolder)) continue;

      const branchKey = resolveBranchKey(branchDir.replace(/-/g, ' '));
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

    await reply(chatId, '📦 Mengirim file hasil generate...');
    await sendDocument(zipPath, chatId, 'Hasil generate voucher');
    await reply(chatId, '✅ *Selesai!* File zip berisi folder/file Excel hasil generate telah dikirim.', mainKeyboard());
  } catch (err) {
    logger.error(`Generate error: ${err.message}`);
    await reply(chatId, `❌ *Generate gagal*\n\n${esc(err.message)}`, mainKeyboard());
  } finally {
    try {
      if (fs.existsSync(baseDir)) fs.rmSync(baseDir, { recursive: true, force: true });
      if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (_) {}
    releaseLock();
  }
}

module.exports = { processGenerate };
