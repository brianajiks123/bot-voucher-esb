const { reply, esc } = require('../helpers');
const { setState, clearState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { resolveBranchKey, BRANCH_DISPLAY, getCredentialsForBranch, BRANCH_LIST } = require('../../config/credentials');
const { processVoucherUpload } = require('../processors/upload');
const { processActivateByCode } = require('../processors/activate');
const { processExtend } = require('../processors/extend');
const { processDelete } = require('../processors/delete');

async function askBranch(chatId, userId, pendingMode, pendingData) {
  setState(userId, 'BRANCH_SELECT', { pendingMode, pendingData: pendingData || null });
  await reply(chatId,
    `🏪 *Pilih Branch*\n\n${BRANCH_LIST}\n\n📝 Kirim nama branch yang sesuai.`,
    mainKeyboard()
  );
}

async function handleBranchReply(chatId, userId, text, state) {
  const branchKey = resolveBranchKey(text);
  if (!branchKey) {
    await reply(chatId, `❓ Branch tidak dikenali. Pilih salah satu:\n\n${BRANCH_LIST}`, mainKeyboard());
    return;
  }

  const branchDisplay   = BRANCH_DISPLAY[branchKey];
  const credentials     = getCredentialsForBranch(branchKey);
  const { pendingMode, pendingData, pendingFileId = null, pendingFileName = null } = state;

  clearState(userId);
  await reply(chatId, `🏪 Branch: ${esc(branchDisplay)}\n⏳ Memproses ${esc(pendingMode)}...`);

  if (pendingMode === 'CREATE' || pendingMode === 'ACTIVATE') {
    if (pendingFileId && pendingFileName) {
      await processVoucherUpload(chatId, userId, pendingMode, pendingFileId, pendingFileName, credentials);
    } else {
      setState(userId, pendingMode, { branchKey, credentials });
      await reply(chatId,
        `📂 Kirim file Excel (.xlsx / .xls) untuk ${esc(pendingMode)} voucher branch ${esc(branchDisplay)}.\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.`,
        mainKeyboard()
      );
    }
  } else if (pendingMode === 'ACTIVATE_CODE') {
    if (pendingData) {
      await processActivateByCode(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'ACTIVATE_CODE', { branchKey, credentials });
      await reply(chatId,
        `🎟️ *Aktivasi Voucher (Kode)* - ${esc(branchDisplay)}\n\nKirim kode voucher. Pisahkan dengan koma jika lebih dari satu.\nTanggal opsional, tambahkan | DD-MM-YYYY jika ingin menentukan tanggal.\n\n📋 Contoh:\nVOUCHER01, VOUCHER02\nVOUCHER01, VOUCHER02 | 27-03-2026\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.`,
        mainKeyboard()
      );
    }
  } else if (pendingMode === 'CHECK') {
    setState(userId, 'CHECK', { branchKey, credentials });
    await reply(chatId,
      `🔍 *Cek Voucher* - ${esc(branchDisplay)}\n\nKirim kode voucher. Pisahkan dengan koma jika lebih dari satu.\n⚠️ Maksimal *100 kode* per request.\n\n📋 Contoh: VOUCHER01, VOUCHER02\n\n⏱️ Sesi kedaluwarsa dalam 5 menit.`,
      mainKeyboard()
    );
  } else if (pendingMode === 'EXTEND') {
    if (pendingData && pendingData.includes('|')) {
      await processExtend(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'EXTEND', { branchKey, credentials });
      await handleExtendPrompt(chatId, branchDisplay);
    }
  } else if (pendingMode === 'DELETE') {
    if (pendingData && pendingData.includes('|')) {
      await processDelete(chatId, userId, pendingData, credentials);
    } else {
      setState(userId, 'DELETE', { branchKey, credentials });
      await handleDeletePrompt(chatId, branchDisplay);
    }
  }
}

async function handleExtendPrompt(chatId, branchDisplay) {
  const label = branchDisplay ? ` - ${esc(branchDisplay)}` : '';
  await reply(chatId,
    `📅 *Ubah Masa Berlaku Voucher*${label}\n\nKirim kode voucher. Tanggal opsional (default: hari ini).\n\n📋 Format:\nKODE1, KODE2\nKODE1, KODE2 | DD-MM-YYYY\n\n📝 Contoh:\nVOUCHER01, VOUCHER02\nVOUCHER01, VOUCHER02 | 31-12-2025`,
    mainKeyboard()
  );
}

async function handleDeletePrompt(chatId, branchDisplay) {
  const label = branchDisplay ? ` - ${esc(branchDisplay)}` : '';
  await reply(chatId,
    `🗑️ *Hapus Voucher*${label}\n\nKirim kode voucher. Tanggal opsional (default: hari ini).\n\n📋 Format:\nKODE1, KODE2\nKODE1, KODE2 | DD-MM-YYYY\n\n📝 Contoh:\nVOUCHER01, VOUCHER02\nVOUCHER01, VOUCHER02 | 31-12-2025`,
    mainKeyboard()
  );
}

module.exports = { askBranch, handleBranchReply, handleExtendPrompt, handleDeletePrompt };
