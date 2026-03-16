# Project Structure

```
bot-voucher-esb/
├── docs/
│   ├── FLOW.md               # Process flow of the Telegram bot
│   └── STRUCTURE.md          # Project structure
├── files/
│   └── tmp/                  # Temp folder per user session (auto-generated & auto-deleted)
├── logs/
│   ├── combined.log          # All logs (auto-generated)
│   └── error.log             # Error logs only (auto-generated)
├── src/
│   ├── config/
│   │   └── credentials.js        # Reads ESB_USERNAME & ESB_PASSWORD from .env
│   ├── telegram/
│   │   ├── telegramClient.js     # HTTP client to Telegram API (sendMessage, getUpdates, etc.)
│   │   ├── notifications.js      # Notification message templates (start, result, error)
│   │   └── bot.js                # Polling loop, command handlers, document handler, state management
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
Entry point. Sends a start notification to Telegram then starts the polling bot.

### `src/config/credentials.js`
Exposes a `credentials` object with `username` and `password` read from `ESB_USERNAME` and `ESB_PASSWORD` environment variables.

### `src/telegram/telegramClient.js`
HTTP wrapper for the Telegram Bot API. Handles `sendMessage`, `getUpdates`, `answerCallbackQuery`, and `validateToken`. All requests use the native `https` module — no external HTTP library required.

### `src/telegram/notifications.js`
Message templates for:
- `sendStartNotification` — sent when the bot first starts
- `sendUploadResultNotification` — sent after upload process with per-file detail (success/failed)
- `sendFatalErrorNotification` — sent when a fatal error occurs before any file is processed, with a contextual hint based on the error type (login, network, etc.)

### `src/telegram/bot.js`
Core bot logic:
- **State management** — tracks per-user waiting state (`CREATE` / `ACTIVATE`) with a 5-minute TTL
- **Command handlers** — `/start`, `/create`, `/activate`, `/status`, `/help`
- **Document handler** — validates file extension, triggers the upload process
- **processVoucherUpload** — downloads file to an isolated temp folder, calls the orchestrator from `voucher-upload-activation-esb`, sends result notification, cleans up temp folder
- **Polling loop** — long polling via `getUpdates` with error recovery

### `src/utils/tempFiles.js`
Manages isolated temp folders per user session:
- `createTempFolder(userId, mode)` — creates a unique folder `files/tmp/<timestamp>-<userId>-<mode>/`
- `deleteTempFolder(folderPath)` — removes the folder and all its contents after processing
- `downloadTelegramFile(botToken, fileId, fileName, destFolder)` — resolves the Telegram file path via `getFile` API then downloads it to the destination folder

### `src/utils/logger.js`
Winston logger with WIB timezone format, outputs to console (non-production) and log files (`logs/`).

### `src/utils/delay.js`
`delay(ms)` helper based on Promise with a debug log.

## Dependency on Sibling Project

This bot does **not** duplicate the upload logic. It requires the orchestrator directly from the sibling project at runtime:

```
../voucher-upload-activation-esb/src/core/orchestrator.js
```

Both projects must exist in the same parent directory. Only `bot-voucher-esb` needs to be running — `voucher-upload-activation-esb` is used as a library, not a separate process.
