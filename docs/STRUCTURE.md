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
│   │   └── credentials.js        # Branch-to-credential mapping, branch resolution
│   ├── telegram/
│   │   ├── telegramClient.js     # HTTP client to Telegram API
│   │   ├── notifications.js      # Notification message templates
│   │   ├── keyboard.js           # Reply keyboard and inline keyboard layouts
│   │   └── bot.js                # Polling loop, command handlers, state management, flow processors
│   ├── voucher/
│   │   └── generator.js          # Voucher Excel generator (7 modes) + ZIP compression
│   └── utils/
│       ├── logger.js             # Winston logger (WIB timezone, file + console)
│       ├── delay.js              # Promise-based delay helper
│       └── tempFiles.js          # Manages temp folders & downloads files from Telegram
├── .env                      # Environment variables
├── .env.example              # Environment variables template
├── ecosystem.config.js       # PM2 process configuration
├── .gitignore
├── index.js                  # Entry point
├── package.json
└── README.md
```

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

| Branch Key        | Display Name          | Credential Group |
|-------------------|-----------------------|------------------|
| `ideologist`      | IDEOLOGIS+            | IMVB             |
| `maari_ventura`   | MAARI VENTURA         | IMVB             |
| `maari_bsb`       | MAARI BSB             | IMVB             |
| `burgas_gombel`   | BURJO NGEGAS GOMBEL   | BURGAS           |
| `burgas_pleburan` | BURJO NGEGAS PLEBURAN | BURGAS           |

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
- `generateModeKeyboard()` — inline keyboard with 7 generate mode options (gen_single … gen_multi_branch)

### `src/telegram/notifications.js`
Message templates:
- `sendStartNotification` — sent once when the bot starts
- `sendUploadResultNotification` — per-file result summary after upload/activate
- `sendFatalErrorNotification` — fatal error with contextual hint (login, network, etc.)
- `sendErrorFileToTelegram` — sends the ESB error Excel file to the user

### `src/telegram/bot.js`
Core bot logic:

**State management** — per-user waiting state with 5-minute TTL:

| Mode                     | Description                                      |
|--------------------------|--------------------------------------------------|
| `BRANCH_SELECT`          | Waiting for branch name reply                    |
| `CREATE`                 | Waiting for Excel file (create mode)             |
| `CREATE_METHOD_SELECT`   | Waiting for inline keyboard tap (/create)        |
| `CREATE_GENERATE`        | Waiting for generate input text                  |
| `ACTIVATE`               | Waiting for Excel file (activate mode)           |
| `ACTIVATE_CODE`          | Waiting for voucher codes (code-based activate)  |
| `ACTIVATE_METHOD_SELECT` | Waiting for inline keyboard tap (/activate)      |
| `CHECK`                  | Waiting for voucher codes to check               |
| `EXTEND`                 | Waiting for codes (+ optional date)              |
| `DELETE`                 | Waiting for codes (+ optional date)              |

**Helper parsers:**
- `parseCodesAndDate(text)` — parses `KODE1, KODE2` or `KODE1, KODE2 | DD-MM-YYYY`; date defaults to today
- `parseCodesForActivate(text)` — same as above, used for activate-by-code flow
- `extractInlineData(rawText)` — extracts data after command for inline usage (e.g. `/extend CODE | DATE`)

**Command handlers:** `/start`, `/create`, `/activate`, `/check`, `/extend`, `/delete`, `/status`, `/help`

**Flow processors:**
- `processVoucherUpload` — downloads file to temp folder, calls orchestrator, sends result, cleans up
- `processGenerate` — generates Excel files + ZIP, uploads per branch, sends ZIP to user, cleans up
- `processActivateByCode` — checks status per code, activates if available, sends result report
- `processVoucherCheck` — calls `checkVoucherCodes`, replies per voucher
- `processExtend` — calls `extendVoucherCodes`, replies with summary
- `processDelete` — calls `deleteVoucherCodes`, replies with summary

**Handlers:**
- `handleDocument` — validates file extension; rejects file if in `ACTIVATE_CODE` mode
- `handleCallbackQuery` — handles all inline button taps
- `handleMessage` — main message router; rejects plain text in `ACTIVATE` (file) mode

**Process locking:** `isProcessing` flag ensures only 1 upload/activate/extend/delete runs at a time.

### `src/voucher/generator.js`
Voucher Excel generator:
- `generateVouchers(input, baseDir)` — parse input, generate Excel files per branch, compress to `.zip`
- Generates two sheets per file: **Voucher** and **Activator**
- Voucher code format: `{PREFIX}{AMOUNT_K}{MONTH_CODE}{2_LETTERS}{BRANCH_CODE}{4_NUMBERS}`

**Supported generation modes:**

| # | Mode                  | Description                                                  |
|---|-----------------------|--------------------------------------------------------------|
| 1 | Single Mode           | One file for the entire period                               |
| 2 | Multiple Mode         | One file per date                                            |
| 3 | Custom Prefix         | Custom voucher code prefix (quoted string)                   |
| 4 | Custom Branch         | Custom "Can Use on Branch" value (quoted string)             |
| 5 | Custom Prefix + Branch| Combination of custom prefix and custom branch               |
| 6 | Multiple Amount       | Multiple voucher amounts in one input                        |
| 7 | Multiple Branches     | Multiple branches separated by ` \| `                       |

Branch aliases used in generator input: `ven`, `bsb`, `gom`, `plb`, `ideo`

### `src/utils/tempFiles.js`
- `createTempFolder(userId, mode)` — creates `files/tmp/<timestamp>-<userId>-<mode>/`
- `deleteTempFolder(folderPath)` — removes folder and contents after processing
- `downloadTelegramFile(botToken, fileId, fileName, destFolder)` — resolves file path via `getFile` API then downloads

### `src/utils/logger.js`
Winston logger with WIB timezone (UTC+7), outputs to console (non-production) and `logs/` files.
- `logs/combined.log` — all log levels
- `logs/error.log` — errors only
- Log level configurable via `LOG_LEVEL` env var (default: `debug`)

### `src/utils/delay.js`
`delay(ms)` — Promise-based delay with a debug log entry.

## Dependency on Sibling Project

This bot does not duplicate the ESB automation logic. It imports functions directly from the sibling project at runtime:

```js
// Upload flow
require('../../../esb-voucher-upload-activation/src/core/orchestrator')

// Check, extend, delete, activate-by-code flows
require('../../../esb-voucher-upload-activation/src/core/esbServices')
```

Both projects must exist in the same parent directory. Only `bot-voucher-esb` needs to be running — `esb-voucher-upload-activation` is used as a library, not a separate process.
