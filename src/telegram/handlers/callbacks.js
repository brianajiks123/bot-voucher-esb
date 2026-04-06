const { reply, esc } = require('../helpers');
const { clearState, setState } = require('../state');
const { mainKeyboard, generateModeKeyboard } = require('../keyboard');
const { answerCallbackQuery, sendMessage } = require('../telegramClient');
const { getLockState } = require('../processingState');
const { askBranch } = require('./branch');

const GENERATE_MODE_PROMPTS = {
  gen_single: {
    title: '1️⃣ *Single Mode* — satu file untuk seluruh periode',
    format: '`single <branch> <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`',
    example: '`single plb 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
  gen_multiple: {
    title: '2️⃣ *Multiple Mode* — satu file per tanggal',
    format: '`multiple <branch> <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`',
    example: '`multiple ven 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
  gen_prefix: {
    title: '3️⃣ *Custom Prefix* — tambahkan prefix kustom di dalam tanda kutip sebelum panjang kode',
    format: '`<mode> <branch> "PREFIX" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`',
    example: '`single gom "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple gom "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
  gen_custom_branch: {
    title: '4️⃣ *Custom Branch* — tentukan branch mana saja yang bisa menggunakan voucher ini\n\nBranch ditulis dalam tanda kutip sebagai token kedua setelah mode, pisahkan dengan koma.',
    format: '`single "<branch1>, <branch2>" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`',
    example: '`single "gom, plb" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple "ven, bsb" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
  gen_prefix_branch: {
    title: '5️⃣ *Custom Prefix + Branch* — gabungan prefix kustom dan custom branch\n\nCustom branch di posisi kedua, prefix di posisi ketiga, keduanya dalam tanda kutip.',
    format: '`single "<branch1>, <branch2>" "PREFIX" <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount>-<qty> "<notes>"`',
    example: '`single "gom, plb" "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`\n`multiple "ven, bsb" "VO" 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
  gen_multi_amount: {
    title: '6️⃣ *Multiple Voucher Amount* — beberapa nominal sekaligus, pisahkan dengan spasi',
    format: '`<mode> <branch> <len> <startDay> <startMonth> - <endDay> <endMonth> <year> <minSales> <amount1>-<qty1> <amount2>-<qty2> "<notes>"`',
    example: '`single bsb 30 1 3 - 18 3 2026 0 10000-15 20000-12 "Promo Testing"`\n`multiple bsb 30 1 3 - 18 3 2026 0 10000-15 20000-12 "Promo Testing"`',
  },
  gen_multi_branch: {
    title: '7️⃣ *Multiple Branches* — pisahkan setiap branch dengan ` | `\n\nCredentials di-resolve otomatis per branch dari alias input.',
    format: '`<cmd1> | <cmd2>`',
    example: '`single ven 30 1 4 - 30 4 2026 0 5000-10 "Testing" | multiple ideo 30 1 4 - 30 4 2026 0 5000-10 "Testing"`',
  },
};

async function handleCallbackQuery(callbackQuery) {
  const chatId  = callbackQuery.message.chat.id;
  const userId  = callbackQuery.from ? callbackQuery.from.id : chatId;
  const data    = callbackQuery.data || '';

  try { await answerCallbackQuery(callbackQuery.id); } catch (_) {}

  const { isProcessing, currentProcess } = getLockState();
  const busyMsg = () => reply(chatId, `⏳ *Proses sedang berjalan*\n\nSaat ini: ${esc(currentProcess)}\nMohon tunggu.`, mainKeyboard());

  if (data === 'create_file') {
    if (isProcessing) { await busyMsg(); return; }
    clearState(userId);
    await askBranch(chatId, userId, 'CREATE');

  } else if (data === 'create_generate') {
    if (isProcessing) { await busyMsg(); return; }
    clearState(userId);
    await sendMessage('⚡ *Generate Voucher*\n\nPilih tipe generate:', chatId, generateModeKeyboard());

  } else if (Object.keys(GENERATE_MODE_PROMPTS).includes(data)) {
    clearState(userId);
    const allowPrefix = data === 'gen_prefix' || data === 'gen_prefix_branch';
    setState(userId, 'CREATE_GENERATE', { credentials: null, allowPrefix });
    const p = GENERATE_MODE_PROMPTS[data];
    await reply(chatId,
      `${p.title}\n\n📋 Format:\n${p.format}\n\n📝 Contoh:\n${p.example}\n\nKirim input generate:`,
      mainKeyboard()
    );

  } else if (data === 'activate_file') {
    if (isProcessing) { await busyMsg(); return; }
    clearState(userId);
    await askBranch(chatId, userId, 'ACTIVATE');

  } else if (data === 'activate_code') {
    if (isProcessing) { await busyMsg(); return; }
    clearState(userId);
    await askBranch(chatId, userId, 'ACTIVATE_CODE');
  }
}

module.exports = { handleCallbackQuery };
