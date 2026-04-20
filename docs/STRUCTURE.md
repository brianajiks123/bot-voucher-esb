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
│   │   └── credentials.js        # Branch-to-credential mapping and alias resolution
│   ├── telegram/
│   │   ├── handlers/
│   │   │   ├── branch.js         # Branch selection reply handler
│   │   │   ├── callbacks.js      # Inline keyboard callback handler
│   │   │   ├── commands.js       # Command handlers (/create, /activate, etc.)
│   │   │   ├── document.js       # File upload handler (validates extension, mode)
│   │   │   └── messages.js       # Main message router
│   │   ├── processors/
│   │   │   ├── activate.js       # processActivateByCode()
│   │   │   ├── check.js          # processVoucherCheck()
│   │   │   ├── delete.js         # processDelete()
│   │   │   ├── extend.js         # processExtend()
│   │   │   ├── generate.js       # processGenerate()
│   │   │   ├── restore.js        # processRestore()
│   │   │   ├── upload.js         # processVoucherUpload()
│   │   │   └── voucherResult.js  # Result report formatting
│   │   ├── bot.js                # Polling loop entry point
│   │   ├── helpers.js            # Shared helpers (parseCodesAndDate, extractInlineData)
│   │   ├── keyboard.js           # Reply and inline keyboard layouts
│   │   ├── notifications.js      # Notification message templates
│   │   ├── processingState.js    # Global process lock (acquireLock / releaseLock)
│   │   ├── state.js              # Per-user state with 5-minute TTL
│   │   └── telegramClient.js     # Telegram API HTTP client with retry logic
│   ├── voucher/
│   │   ├── excel.js              # ExcelJS workbook creation (Voucher + Activator sheets)
│   │   ├── generator.js          # Voucher generator entry point (7 modes) + ZIP
│   │   ├── parser.js             # Input string parser for generate commands
│   │   └── zip.js                # ZIP compression utility (archiver)
│   └── utils/
│       ├── delay.js              # Promise-based delay helper
│       ├── logger.js             # Winston logger (WIB timezone, file + console)
│       └── tempFiles.js          # Temp folder management and Telegram file downloads
├── .env                      # Environment variables (not committed)
├── .env.example              # Environment variables template
├── ecosystem.config.js       # PM2 process configuration
├── index.js                  # Entry point
└── package.json
```

---

## Module Descriptions

### `index.js`
Entry point. Prints startup banner then calls `startBot()`.

### `src/config/credentials.js`
Manages multi-branch credential resolution:
- `resolveBranchKey(input)` — normalizes user input to a canonical branch key
- `getCredentialsForBranch(branchKey)` — returns `{ username, password }` for the branch
- `BRANCH_DISPLAY` — human-readable branch names shown in ERP
- `BRANCH_LIST` — formatted list of valid branch inputs shown to users

Supported branches and their credential groups:

| Branch Key        | Display Name          | Aliases                    | Credential Group |
|-------------------|-----------------------|----------------------------|------------------|
| `ideologist`      | IDEOLOGIS+            | ideo, ideologis+           | IMVB             |
| `maari_ventura`   | MAARI VENTURA         | ven, ventura               | IMVB             |
| `maari_bsb`       | MAARI BSB             | bsb                        | IMVB             |
| `burgas_gombel`   | BURJO NGEGAS GOMBEL   | gom, burgas gombel         | BURGAS           |
| `burgas_pleburan` | BURJO NGEGAS PLEBURAN | plb, burgas pleburan       | BURGAS           |

---

### `src/telegram/bot.js`
Polling loop entry point. Calls `validateToken()`, `setMyCommands()`, `sendStartNotification()`, then runs the `getUpdates()` loop — routing each update to `handleMessage()` or `handleCallbackQuery()`.

### `src/telegram/helpers.js`
Shared parsing utilities used across processors and handlers:
- `parseCodesAndDate(text)` — parses `KODE1, KODE2` or `KODE1, KODE2 | DD-MM-YYYY`; date defaults to today
- `parseCodesForActivate(text)` — same as above, used for activate-by-code flow
- `extractInlineData(rawText)` — extracts data after command for inline usage (e.g. `/extend CODE | DATE`)

### `src/telegram/state.js`
Per-user state management with 5-minute TTL:
- `setState(userId, mode, extra)` — sets state with expiry
- `getState(userId)` — returns state or `null` if expired
- `clearState(userId)` — removes state immediately
- `onStateExpire(userId, callback)` — registers a callback fired on state expiry

### `src/telegram/processingState.js`
Global process lock — ensures only 1 operation runs at a time:
- `acquireLock(label)` — returns `false` if already locked
- `releaseLock()` — releases the lock
- `getLockState()` — returns `{ isProcessing, currentProcess }`

### `src/telegram/telegramClient.js`
HTTP wrapper for the Telegram Bot API using the native `https` module:
- `sendMessage(text, chatId, replyMarkup)` — with retry + exponential backoff (3x, 2s/4s/8s)
- `sendDocument(filePath, chatId, caption)` — multipart upload
- `getUpdates(offset)` — long polling, includes `message` and `callback_query`
- `answerCallbackQuery(callbackQueryId)` — dismisses inline button loading spinner
- `validateToken()` — calls `getMe` to verify token
- `setMyCommands(commands)` — registers command list in Telegram UI

### `src/telegram/keyboard.js`
- `mainKeyboard()` — persistent reply keyboard with all 7 command buttons
- `createOptionsKeyboard()` — inline keyboard for `/create` method selection:
  - `📁 Via File Excel` → `callback_data: 'create_file'`
  - `⚡ Generate` → `callback_data: 'create_generate'`
- `activateOptionsKeyboard()` — inline keyboard for `/activate` method selection:
  - `📁 Via File Excel` → `callback_data: 'activate_file'`
  - `🔑 Input Kode Voucher` → `callback_data: 'activate_code'`
- `generateModeKeyboard()` — inline keyboard with 7 generate mode options (`gen_single` … `gen_multi_branch`)

### `src/telegram/notifications.js`
Message templates:
- `sendStartNotification` — sent once when the bot starts
- `sendUploadResultNotification` — per-file result summary after upload/activate
- `sendFatalErrorNotification` — fatal error with contextual hint (login, network, etc.)
- `sendErrorFileToTelegram` — sends the ESB error Excel file to the user

---

### `src/telegram/handlers/messages.js`
Main message router. Dispatches incoming messages to the appropriate handler based on type (command, document, branch reply, or text input). Rejects plain text when mode expects a file.

### `src/telegram/handlers/commands.js`
Handles all bot commands: `/start`, `/create`, `/activate`, `/check`, `/extend`, `/delete`, `/status`, `/help`. Calls `askBranch()` or sets state as needed.

### `src/telegram/handlers/branch.js`
Handles branch name text replies when state is `BRANCH_SELECT`. Calls `resolveBranchKey()` → `getCredentialsForBranch()` then resumes the pending flow.

### `src/telegram/handlers/document.js`
Handles file uploads. Validates extension (`.xlsx` / `.xls`). Rejects file if current mode is `ACTIVATE_CODE`.

### `src/telegram/handlers/callbacks.js`
Handles all inline keyboard button taps. Calls `answerCallbackQuery()` then routes to the appropriate state or processor based on `callback_data`.

---

### `src/telegram/processors/upload.js`
`processVoucherUpload(mode)` — downloads file to temp folder, calls `voucherUploadOrchestrate()`, sends result notification, sends error Excel if any, then cleans up temp folder.

### `src/telegram/processors/generate.js`
`processGenerate(text)` — calls `generateVouchers()`, uploads per branch, sends `.zip` to user, cleans up. Always deletes temp files in `finally` block.

### `src/telegram/processors/activate.js`
`processActivateByCode(credentials, codes, date)` — for each code: checks status via `checkVoucherByCode()`, activates if `available`, records reason if not.

### `src/telegram/processors/check.js`
`processVoucherCheck(credentials, codes)` — calls `checkVoucherCodes()`, replies per voucher.

### `src/telegram/processors/extend.js`
`processExtend(credentials, codes, date)` — calls `extendVoucherCodes()`, replies with summary.

### `src/telegram/processors/delete.js`
`processDelete(credentials, codes, date)` — calls `deleteVoucherCodes()`, replies with summary.

### `src/telegram/processors/restore.js`
`processRestore(credentials, codes, date)` — calls `restoreVoucherCodes()`, replies with summary. Clicks the Restore button on ESB ERP and fills the popup dialog (Purpose + Journal Date).

### `src/telegram/processors/voucherResult.js`
Formats result report messages for upload and activate operations.

---

### `src/voucher/generator.js`
Entry point for voucher generation. Calls `parseGenerateInput()`, generates Excel files per branch via `writeVoucherWorkbook()`, then compresses to `.zip` via `compressToZip()`.

Voucher code format: `{PREFIX}{AMOUNT_K}{MONTH_CODE}{2_LETTERS}{BRANCH_CODE}{4_NUMBERS}` (max 20 chars)

**Supported generation modes:**

| # | Mode                   | Description                                              |
|---|------------------------|----------------------------------------------------------|
| 1 | Single Mode            | One file for the entire period                           |
| 2 | Multiple Mode          | One file per date                                        |
| 3 | Custom Prefix          | Custom voucher code prefix (quoted string)               |
| 4 | Custom Branch          | Custom "Can Use on Branch" value (quoted string)         |
| 5 | Custom Prefix + Branch | Combination of custom prefix and custom branch           |
| 6 | Multiple Amount        | Multiple voucher amounts in one input                    |
| 7 | Multiple Branches      | Multiple branches separated by ` \| `                   |

### `src/voucher/parser.js`
Parses the generate input string into a structured object. Handles all 7 modes, quoted strings for prefix/branch, date ranges, and multi-amount/multi-branch variants.

### `src/voucher/excel.js`
Creates ExcelJS workbooks with two sheets per file: **Voucher** and **Activator**. Handles column formatting and data population.

### `src/voucher/zip.js`
`compressToZip(sourceDir, outputPath)` — compresses a directory into a `.zip` file using `archiver`.

---

### `src/utils/tempFiles.js`
- `createTempFolder(userId, mode)` — creates `files/tmp/<timestamp>-<userId>-<mode>/`
- `deleteTempFolder(folderPath)` — removes folder and all contents after processing
- `downloadTelegramFile(botToken, fileId, fileName, destFolder)` — resolves file path via `getFile` API then downloads

### `src/utils/logger.js`
Winston logger with WIB timezone (UTC+7), outputs to console (non-production) and `logs/` files.
- `logs/combined.log` — all log levels
- `logs/error.log` — errors only
- Log level configurable via `LOG_LEVEL` env var (default: `debug`)

### `src/utils/delay.js`
`delay(ms)` — Promise-based delay with a debug log entry.

---

## Dependency on Sibling Project

This bot does not duplicate the ESB automation logic. It imports functions directly from the sibling project at runtime:

```js
// Upload flow
require('../../../esb-voucher-upload-activation/src/core/orchestrator')

// Check, extend, delete, activate-by-code flows
require('../../../esb-voucher-upload-activation/src/core/esbServices')
```

Both projects must exist in the same parent directory. Only `bot-voucher-esb` needs to be running — `esb-voucher-upload-activation` is used as a library, not a separate process.
