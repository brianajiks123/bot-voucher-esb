/**
 * keyboard.js
 * Persistent reply keyboard shown below the Telegram chat input.
 */

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

module.exports = { mainKeyboard };
