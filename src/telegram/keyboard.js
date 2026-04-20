function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '/create' },  { text: '/activate' }],
      [{ text: '/check' },   { text: '/extend'   }],
      [{ text: '/delete' },  { text: '/restore'  }],
      [{ text: '/status' },  { text: '/help'     }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

function createOptionsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📁 Via File Excel', callback_data: 'create_file' },
        { text: '⚡ Generate',       callback_data: 'create_generate' },
      ],
    ],
  };
}

function activateOptionsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📁 Via File Excel', callback_data: 'activate_file' },
        { text: '🔑 Input Kode Voucher', callback_data: 'activate_code' },
      ],
    ],
  };
}

function generateModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '1️⃣  Single Mode',            callback_data: 'gen_single'        }],
      [{ text: '2️⃣  Multiple Mode',           callback_data: 'gen_multiple'      }],
      [{ text: '3️⃣  Custom Prefix',           callback_data: 'gen_prefix'        }],
      [{ text: '4️⃣  Custom Branch',           callback_data: 'gen_custom_branch' }],
      [{ text: '5️⃣  Custom Prefix + Branch',  callback_data: 'gen_prefix_branch' }],
      [{ text: '6️⃣  Multiple Voucher Amount', callback_data: 'gen_multi_amount'  }],
      [{ text: '7️⃣  Multiple Branches',       callback_data: 'gen_multi_branch'  }],
    ],
  };
}

module.exports = { mainKeyboard, createOptionsKeyboard, activateOptionsKeyboard, generateModeKeyboard };
