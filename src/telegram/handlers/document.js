const { reply, esc } = require('../helpers');
const { getState, setState } = require('../state');
const { mainKeyboard } = require('../keyboard');
const { processVoucherUpload } = require('../processors/upload');

async function handleDocument(chatId, userId, document) {
  const state = getState(userId);

  if (state && state.mode === 'ACTIVATE_CODE') {
    await reply(chatId, '⚠️ Anda memilih opsi input kode voucher. Kirim kode voucher, bukan file Excel.', mainKeyboard());
    return;
  }

  const fileName = document.file_name || 'voucher.xlsx';
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    await reply(chatId, '❌ Format tidak didukung. Kirim file .xlsx atau .xls.', mainKeyboard());
    return;
  }

  if (state && state.mode === 'BRANCH_SELECT' && (state.pendingMode === 'CREATE' || state.pendingMode === 'ACTIVATE')) {
    setState(userId, 'BRANCH_SELECT', {
      pendingMode: state.pendingMode,
      pendingData: state.pendingData,
      pendingFileId: document.file_id,
      pendingFileName: fileName,
    });
    await reply(chatId,
      `📂 File diterima: ${esc(fileName)}\n\n🏪 Silakan isi nama branch terlebih dahulu:\n\n${require('../../config/credentials').BRANCH_LIST}\n\n📝 Kirim nama branch yang sesuai.`,
      mainKeyboard()
    );
    return;
  }

  if (!state || (state.mode !== 'CREATE' && state.mode !== 'ACTIVATE')) {
    await reply(chatId, '⚠️ Kirim /create atau /activate terlebih dahulu.', mainKeyboard());
    return;
  }

  await processVoucherUpload(chatId, userId, state.mode, document.file_id, fileName, state.credentials);
}

module.exports = { handleDocument };
