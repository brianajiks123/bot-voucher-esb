// Returns the main command keyboard layout
function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '/create' }, { text: '/activate' }],
      [{ text: '/check' },  { text: '/extend'   }],
      [{ text: '/delete' }, { text: '/status'   }],
      [{ text: '/help' }],
    ],
    resize_keyboard: true,
    persistent: true,
  };
}

// Returns inline keyboard for activate method selection
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

module.exports = { mainKeyboard, activateOptionsKeyboard };
