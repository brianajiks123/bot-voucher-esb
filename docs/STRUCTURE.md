# Project Structure

```
bot-voucher-esb/
├── docs/
│   ├── FLOW.md               # Process flow of the Telegram bot
│   └── STRUCTURE.md          # This file
├── files/
│   └── tmp/                  # Temp folder per user session (auto-generated & auto-deleted)
├── logs/
│   ├── combined.log          # All logs (auto-generated)
│   └── error.log             # Error logs only (auto-generated)
├── src/
│   ├── config/
│   │   └── credentials.js        # Reads ESB_USERNAME & ESB_PASSWORD from .env
│   ├── telegram/
│   │   ├── telegramClient.js     # HTTP client to Telegram API (sendMessage, getUpdates, setMyCommands, etc.)
│   │   ├── notifications.js      # Notification message templates (start, upload result, fatal error)
│   │   ├── keyboard.js           # Persistent reply keyboard layout
│   │   └── bot.js                # Polling loop, command handlers, state management, flow processors
│   └── utils/
│       ├── logger.js             # Winston logger (WIB timezone, file + console)
│       ├── delay.js              # Promise-based delay helper
│       └── tempFiles.js          # Manages temp folders & downloads files from Telegram
├── .env                      # Environment variables
├── .env.example              # Environment variables template
├── .gitignore
├── index.js                  # Entry point
├── package.json
└── README.md
```

## Module Descriptions

### `index.js`
Entry point. Prints startup banner then calls `startBot()`.

### `src/config/credentials.js`
Exposes a `credentials` object with `username` and `password` from `ESB_USERNAME` / `ESB_PASSWORD` env vars.

### `src/telegram/telegramClient.js`
HTTP wrapper for the Telegram Bot API using the native `https` module. Handles `sendMessage` (with retry + exponential backoff), `getUpdates` (long polling), `validateToken`, `setMyCommands`, and `answerCallbackQuery`.

### `src/telegram/keyboard.js`
Exports `mainKeyboard()` — the persistent reply keyboard shown below the chat input with all 7 command buttons.

### `src/telegram/notifications.js`
Message templates:
- `sendStartNotification` — sent once when the bot starts
- `sendUploadResultNotification` — per-file result summary after upload
- `sendFatalErrorNotification` — fatal error with contextual hint (login, network, etc.)

### `src/telegram/bot.js`
Core bot logic:
- **State management** — per-user waiting state (`CREATE` / `ACTIVATE` / `CHECK` / `EXTEND` / `DELETE`) with 5-minute TTL
- **Command handlers** — `/start`, `/create`, `/activate`, `/check`, `/extend`, `/delete`, `/status`, `/help`
- **Inline support** — `/extend` and `/delete` accept data in the same message: `/extend KODE1, KODE2 | DD-MM-YYYY`
- **Document handler** — validates file extension, triggers upload flow
- **processVoucherUpload** — downloads file to isolated temp folder, calls orchestrator, sends result, cleans up
- **processExtend** — parses codes + date, calls `extendVoucherCodes`; btnUpdate presence determines eligibility
- **processDelete** — parses codes + date, calls `deleteVoucherCodes`; btnDelete presence determines eligibility
- **Polling loop** — long polling via `getUpdates` with error recovery

### `src/utils/tempFiles.js`
- `createTempFolder(userId, mode)` — creates `files/tmp/<timestamp>-<userId>-<mode>/`
- `deleteTempFolder(folderPath)` — removes folder and contents after processing
- `downloadTelegramFile(botToken, fileId, fileName, destFolder)` — resolves file path via `getFile` API then downloads

### `src/utils/logger.js`
Winston logger with WIB timezone, outputs to console (non-production) and `logs/` files.

### `src/utils/delay.js`
`delay(ms)` helper based on `Promise` with a debug log.

## Dependency on Sibling Project

This bot does not duplicate the upload logic. It requires the orchestrator directly from the sibling project at runtime:

```
../esb-voucher-upload-activation/src/core/orchestrator.js
```

Both projects must exist in the same parent directory. Only `bot-voucher-esb` needs to be running — `esb-voucher-upload-activation` is used as a library, not a separate process.
