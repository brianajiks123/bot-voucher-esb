const { parseCommand, extractInlineData } = require('../helpers');
const { getState } = require('../state');
const { handleDocument } = require('./document');
const { askBranch, handleBranchReply } = require('./branch');
const { handleStart, handleCreate, handleActivate, handleStatus, handleHelp } = require('./commands');
const { processActivateByCode } = require('../processors/activate');
const { processVoucherCheck } = require('../processors/check');
const { processExtend } = require('../processors/extend');
const { processDelete } = require('../processors/delete');
const { processGenerate, handleGenerateConfirm } = require('../processors/generate');
const { reply } = require('../helpers');
const { mainKeyboard } = require('../keyboard');

async function handleMessage(message) {
  const chatId  = message.chat.id;
  const userId  = message.from ? message.from.id : chatId;
  const rawText = message.text ? message.text.trim() : '';
  const cmd     = parseCommand(rawText);

  if (message.document) {
    await handleDocument(chatId, userId, message.document);
    return;
  }

  const state = getState(userId);

  if (state && rawText && !rawText.startsWith('/')) {
    switch (state.mode) {
      case 'BRANCH_SELECT':
        await handleBranchReply(chatId, userId, rawText, state);
        return;
      case 'ACTIVATE_CODE':
        await processActivateByCode(chatId, userId, rawText, state.credentials);
        return;
      case 'ACTIVATE':
        await reply(chatId, 'Anda memilih opsi aktivasi via file. Kirim file Excel (.xlsx / .xls), bukan kode voucher.', mainKeyboard());
        return;
      case 'CHECK':
        await processVoucherCheck(chatId, userId, rawText, state.credentials);
        return;
      case 'EXTEND':
        await processExtend(chatId, userId, rawText, state.credentials);
        return;
      case 'DELETE':
        await processDelete(chatId, userId, rawText, state.credentials);
        return;
      case 'CREATE_GENERATE':
        await processGenerate(chatId, userId, rawText, state.credentials, state.allowPrefix);
        return;
      case 'GENERATE_CONFIRM':
        await handleGenerateConfirm(chatId, userId, rawText, state);
        return;
    }
  }

  if (cmd.startsWith('/extend')) {
    await askBranch(chatId, userId, 'EXTEND', extractInlineData(rawText));
    return;
  }
  if (cmd.startsWith('/delete')) {
    await askBranch(chatId, userId, 'DELETE', extractInlineData(rawText));
    return;
  }

  if (cmd === '/start' || cmd === '/menu') await handleStart(chatId);
  else if (cmd === '/create')              await handleCreate(chatId, userId);
  else if (cmd === '/activate')            await handleActivate(chatId, userId);
  else if (cmd === '/check')               await askBranch(chatId, userId, 'CHECK');
  else if (cmd === '/status')              await handleStatus(chatId);
  else if (cmd === '/help')                await handleHelp(chatId);
}

module.exports = { handleMessage };
